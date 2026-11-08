// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { runWithFakedTimers } from '../../../../base/test/common/virtualScheduling/index.js';
import type { ServiceKind } from '../../../engine/common/engine.js';
import type { IndicatorContent } from '../../common/indicator.js';
import type { HostedPeer, HostingStatus } from '../../electron-main/hostingMainService.js';
import { INDICATOR_OPEN_MS, SessionIndicator, type IndicatorHosting, type IndicatorSurface } from '../../electron-main/sessionIndicator.js';

const nobody: HostingStatus = { available: true, accepting: true, hosting: true, sessions: [] };

function peer(id: string, name: string, ...services: ServiceKind[]): HostedPeer {
	return { id, name, phase: 'Active', services };
}

function connected(...sessions: HostedPeer[]): HostingStatus {
	return { ...nobody, sessions };
}

class TestHosting extends Disposable implements IndicatorHosting {
	private readonly changed = this._register(new Emitter<HostingStatus>());
	public readonly onDidChangeStatus = this.changed.event;
	public status = nobody;
	public readonly disconnected: string[] = [];

	public set(status: HostingStatus): void {
		this.status = status;
		this.changed.fire(status);
	}

	public disconnect(sessionId: string): Promise<void> {
		this.disconnected.push(sessionId);
		return Promise.resolve();
	}
}

/** The window: what it was asked to show, and the page's messages, which the test sends. */
class TestSurface implements IndicatorSurface {
	public readonly disconnects = new Emitter<string>();
	public readonly onDidDisconnect = this.disconnects.event;
	public readonly attention = new Emitter<boolean>();
	public readonly onDidChangeAttention = this.attention.event;
	public readonly closes = new Emitter<void>();
	public readonly onDidClose = this.closes.event;
	public readonly shown: (readonly [IndicatorContent, boolean])[] = [];
	public disposed = false;

	public show(content: IndicatorContent, focus: boolean): void {
		this.shown.push([content, focus]);
	}

	public dispose(): void {
		this.disposed = true;
		this.disconnects.dispose();
		this.attention.dispose();
		this.closes.dispose();
	}
}

suite('SessionIndicator', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let hosting: TestHosting;
	let surfaces: TestSurface[];
	let errors: unknown[];
	setup(() => {
		hosting = disposables.add(new TestHosting());
		surfaces = [];
		errors = [];
	});
	function indicator(): SessionIndicator {
		return disposables.add(new SessionIndicator(hosting, () => {
			const surface = new TestSurface();
			surfaces.push(surface);
			return surface;
		}, error => errors.push(error), () => 1_000));
	}

	/** Whether a window is open now. */
	function open(): boolean {
		return surfaces.some(surface => !surface.disposed);
	}
	test('a computer starting to use this one shows it, without taking the keyboard', () => {
		indicator();
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop')));
		assert.deepStrictEqual(surfaces[0].shown, [[{ computers: [{ id: '1', name: 'Work laptop', services: ['Desktop'], since: 1_000 }] }, false]]);
	});
	test('the window closes by itself', () => runWithFakedTimers({}, async () => {
		indicator();
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop')));
		await timeout(INDICATOR_OPEN_MS - 1);
		assert.ok(open(), 'still open just before');
		await timeout(1);
		assert.ok(!open(), 'closed');
	}));
	test('the pointer or focus in the window holds it open, and leaving counts down again', () => runWithFakedTimers({}, async () => {
		indicator();
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop')));
		surfaces[0].attention.fire(true);
		await timeout(INDICATOR_OPEN_MS * 3);
		assert.ok(open(), 'held open');
		surfaces[0].attention.fire(false);
		await timeout(INDICATOR_OPEN_MS - 1);
		assert.ok(open(), 'counts down from the start');
		await timeout(1);
		assert.ok(!open(), 'closed');
	}));
	test('nothing new does not show it again', () => runWithFakedTimers({}, async () => {
		indicator();
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop')));
		await timeout(INDICATOR_OPEN_MS);
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop')));
		assert.strictEqual(surfaces.length, 1);
	}));
	test('a computer starting to use something more shows it again', () => runWithFakedTimers({}, async () => {
		indicator();
		hosting.set(connected(peer('1', 'Work laptop', 'Files')));
		await timeout(INDICATOR_OPEN_MS);
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop', 'Files')));
		assert.strictEqual(surfaces.length, 2);
		assert.deepStrictEqual(surfaces[1].shown.at(-1)?.[0].computers[0].services, ['Desktop', 'Files']);
	}));
	test('it closes as soon as no one is connected', () => {
		indicator();
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop')));
		hosting.set(nobody);
		assert.ok(!open());
	});
	test('Disconnect in the window ends that computer\'s connection', () => {
		indicator();
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop'), peer('2', 'host-b', 'Files')));
		surfaces[0].disconnects.fire('2');
		assert.deepStrictEqual(hosting.disconnected, ['2']);
	});
	test('the tray shows it with the keyboard while anyone is connected, and not otherwise', () => runWithFakedTimers({}, async () => {
		const shown = indicator();
		shown.show();
		assert.strictEqual(surfaces.length, 0, 'no one is connected');
		hosting.set(connected(peer('1', 'Work laptop', 'Desktop')));
		await timeout(INDICATOR_OPEN_MS);
		shown.show();
		assert.strictEqual(surfaces[1].shown.at(-1)?.[1], true);
		assert.deepStrictEqual(errors, []);
	}));
});
