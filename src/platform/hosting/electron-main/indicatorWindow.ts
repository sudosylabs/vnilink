// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import { app, screen } from 'electron';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { createFloatingWindow } from '../../systemActions/electron-main/noticeWindow.js';
import { INDICATOR_ATTENTION_CHANNEL, INDICATOR_DISCONNECT_CHANNEL, INDICATOR_MATERIAL_CHANNEL, INDICATOR_SHOW_CHANNEL, INDICATOR_URL, isIndicatorSessionId, type IndicatorContent } from '../common/indicator.js';
import type { IndicatorSurface } from './sessionIndicator.js';

const width = 340;
/** The window's margin from the screen's corner. */
const margin = 12;
/** The header and padding, and each listed computer; more than four scroll. */
const chrome = 64;

const row = 64;

const visibleRows = 4;

/**
 * The connected-computers window: a floating window in the top-right corner
 * of the screen with the pointer. It answers only to its own page. Wayland
 * compositors may place it elsewhere; they choose where windows go.
 */
export class IndicatorWindow extends Disposable implements IndicatorSurface {
	private readonly disconnectRequested = this._register(new Emitter<string>());
	public readonly onDidDisconnect = this.disconnectRequested.event;
	private readonly attentionChanged = this._register(new Emitter<boolean>());
	public readonly onDidChangeAttention = this.attentionChanged.event;
	private readonly closed = this._register(new Emitter<void>());
	public readonly onDidClose = this.closed.event;
	private readonly window: Electron.BrowserWindow;
	private loaded = false;
	/** What to show once the page has loaded, and whether to focus it then. */
	private pending: { readonly content: IndicatorContent; readonly focus: boolean } | undefined;

	constructor() {
		super();
		const { window, backdrop } = createFloatingWindow({ bounds: this.bounds(1), preload: 'indicatorPreload.cjs', closable: true });
		this.window = window;
		this._register(backdrop);
		this._register(toDisposable(() => {
			if (!window.isDestroyed()) {
				window.destroy();
			}
		}));
		const contents = window.webContents;
		const fromPage = (event: Electron.IpcMainEvent): boolean => event.senderFrame === contents.mainFrame && event.senderFrame.url === INDICATOR_URL;
		contents.ipc.on(INDICATOR_DISCONNECT_CHANNEL, (event, sessionId: unknown) => {
			if (fromPage(event) && isIndicatorSessionId(sessionId)) {
				this.disconnectRequested.fire(sessionId);
			}
		});
		contents.ipc.on(INDICATOR_ATTENTION_CHANNEL, (event, held: unknown) => {
			if (fromPage(event) && typeof held === 'boolean') {
				this.attentionChanged.fire(held);
			}
		});
		const sendMaterial = (): void => {
			if (!contents.isDestroyed()) {
				contents.send(INDICATOR_MATERIAL_CHANNEL, backdrop.material);
			}
		};
		this._register(backdrop.onDidChange(sendMaterial));
		contents.once('did-finish-load', () => {
			this.loaded = true;
			sendMaterial();
			const pending = this.pending;
			this.pending = undefined;
			if (pending) {
				this.show(pending.content, pending.focus);
			}
		});
		window.once('closed', () => {
			this.closed.fire();
		});
		window.loadURL(INDICATOR_URL).catch(() => {
			this.closed.fire();
		});
	}

	public show(content: IndicatorContent, focus: boolean): void {
		if (this.window.isDestroyed()) {
			return;
		}
		if (!this.loaded) {
			this.pending = { content, focus: focus || this.pending?.focus === true };
			return;
		}
		this.window.setBounds(this.bounds(content.computers.length));
		this.window.webContents.send(INDICATOR_SHOW_CHANNEL, content);
		if (focus) {
			// Asked for from the tray: the person comes to it, by pointer or keyboard.
			if (isMacintosh) {
				app.focus({ steal: true });
			}
			this.window.show();
			this.window.focus();
		} else if (!this.window.isVisible()) {
			// It tells; it never takes the keyboard from what the person is doing.
			this.window.showInactive();
		}
	}

	/** The top-right corner of the work area on the screen with the pointer, as tall as `count` computers need. */
	private bounds(count: number): Electron.Rectangle {
		const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
		const height = chrome + row * Math.max(1, Math.min(count, visibleRows));
		return { width, height, x: area.x + area.width - width - margin, y: area.y + margin };
	}
}
