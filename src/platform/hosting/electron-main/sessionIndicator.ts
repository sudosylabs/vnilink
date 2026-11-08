// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import { RunOnceScheduler } from '../../../base/common/async.js';
import type { Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import type { ServiceKind } from '../../engine/common/engine.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILifecycleMainService, type LifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { INDICATOR_MAX_COMPUTERS, type IndicatorContent } from '../common/indicator.js';
import { IHostingMainService, type HostingMainService, type HostingStatus } from './hostingMainService.js';
import { IndicatorWindow } from './indicatorWindow.js';

/** How long the window stays once nothing holds it open. */
export const INDICATOR_OPEN_MS = 8000;

/** The window the indicator shows its list in. */
export interface IndicatorSurface {
	readonly onDidDisconnect: Event<string>;
	/** Whether the pointer or keyboard focus is in it. */
	readonly onDidChangeAttention: Event<boolean>;
	/** The person or the system closed it. */
	readonly onDidClose: Event<void>;
	/** Shows `content`, and with `focus` takes the keyboard; without, it never does. */
	show(content: IndicatorContent, focus: boolean): void;
	dispose(): void;
}

/** Who is connected, and how to end one connection. */
export type IndicatorHosting = Pick<HostingMainService, 'status' | 'onDidChangeStatus' | 'disconnect'>;

/**
 * Shows who is connected to this computer when it changes: a computer starts
 * using it, or starts using something more. The window closes itself after
 * {@link INDICATOR_OPEN_MS} unless the pointer or focus is in it, and at once
 * when no one is connected; the tray shows it again on request.
 */
export class SessionIndicator extends Disposable {
	private surface: IndicatorSurface | undefined;
	private readonly surfaceListeners = this._register(new DisposableStore());
	/** When each session was first seen using something. */
	private readonly since = new Map<string, number>();
	/** What each session has been seen using, so only something new opens the window. */
	private readonly seen = new Map<string, Set<ServiceKind>>();
	private held = false;
	private readonly closer = this._register(new RunOnceScheduler(() => {
		this.close();
	}, INDICATOR_OPEN_MS));

	constructor(
		private readonly hosting: IndicatorHosting,
		private readonly createSurface: () => IndicatorSurface,
		private readonly onError: (error: unknown) => void,
		private readonly now: () => number = Date.now,
	) {
		super();
		this._register(hosting.onDidChangeStatus(status => {
			this.update(status);
		}));
		this._register({
			dispose: () => {
				this.close();
			},
		});
		this.update(hosting.status);
	}

	/** Shows the window and gives it the keyboard, while anyone is connected. */
	public show(): void {
		if (this.hosting.status.sessions.length) {
			this.open(true);
		}
	}

	/** Closes the window; it opens again when something changes. */
	public close(): void {
		this.closer.cancel();
		this.held = false;
		this.surfaceListeners.clear();
		this.surface?.dispose();
		this.surface = undefined;
	}

	private update(status: HostingStatus): void {
		const live = new Set(status.sessions.map(session => session.id));
		for (const id of [...this.since.keys()]) {
			if (!live.has(id)) {
				this.since.delete(id);
				this.seen.delete(id);
			}
		}
		let changed = false;
		for (const session of status.sessions) {
			if (!this.since.has(session.id)) {
				this.since.set(session.id, this.now());
			}
			const seen = this.seen.get(session.id) ?? new Set<ServiceKind>();
			this.seen.set(session.id, seen);
			for (const kind of session.services) {
				if (!seen.has(kind)) {
					seen.add(kind);
					changed = true;
				}
			}
		}
		if (!status.sessions.length) {
			this.close();
		} else if (changed) {
			this.open(false);
		} else {
			this.surface?.show(this.content(), false);
		}
	}

	private open(focus: boolean): void {
		if (!this.surface) {
			const surface = this.createSurface();
			this.surface = surface;
			this.surfaceListeners.add(surface.onDidDisconnect(sessionId => {
				this.hosting.disconnect(sessionId).catch(this.onError);
			}));
			this.surfaceListeners.add(surface.onDidChangeAttention(held => {
				this.held = held;
				this.schedule();
			}));
			this.surfaceListeners.add(surface.onDidClose(() => {
				this.close();
			}));
		}
		this.surface.show(this.content(), focus);
		this.schedule();
	}

	/** Counts down again from the start, unless the window is held open. */
	private schedule(): void {
		if (this.held) {
			this.closer.cancel();
		} else {
			this.closer.schedule();
		}
	}

	private content(): IndicatorContent {
		return {
			computers: this.hosting.status.sessions.slice(0, INDICATOR_MAX_COMPUTERS).map(session => ({
				id: session.id, name: session.name, services: session.services, since: this.since.get(session.id) ?? this.now(),
			})),
		};
	}
}

export const ISessionIndicatorMainService = createDecorator<SessionIndicatorMainService>('sessionIndicatorMainService');

/** The connected-computers window, for the life of the application. */
export class SessionIndicatorMainService extends Disposable {
	declare public readonly _serviceBrand: undefined;
	private indicator: SessionIndicator | undefined;

	constructor(
		@IHostingMainService private readonly hosting: HostingMainService,
		@ILifecycleMainService private readonly lifecycle: LifecycleMainService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	public start(): void {
		if (this.indicator) {
			return;
		}
		const indicator = this._register(new SessionIndicator(this.hosting, () => new IndicatorWindow(), error => {
			this.logService.error('The device could not be disconnected.', error);
		}));
		this.indicator = indicator;
		// Before the windows close: an open window would hold the quit.
		this._register(this.lifecycle.onWillShutdown(() => {
			indicator.dispose();
		}));
	}

	/** Shows who is connected, as the tray asks. */
	public show(): void {
		this.indicator?.show();
	}
}
