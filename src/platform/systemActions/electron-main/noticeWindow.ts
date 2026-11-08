// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { release } from 'node:os';
import { join } from 'node:path';
import { isMacintosh } from '../../../base/common/platform.js';
import { getWindowColors } from '../../theme/common/windowColors.js';
import { resolveWindowMaterial, windowPlatform } from '../../window/common/windowMaterial.js';
import { WindowMaterial } from '../../windows/electron-main/windowMaterial.js';
import { product } from '../../product/common/product.js';
import { isNoticeAnswer, NOTICE_MATERIAL_CHANNEL, NOTICE_RESPOND_CHANNEL, NOTICE_SHOW_CHANNEL, NOTICE_URL, type NoticeContent } from '../common/notice.js';
import type { NoticePrompt } from './systemActionNotice.js';

const width = 460;

const height = 168;

/** Cancel is the first answer, as in `SystemActionNotices`. */
const answers = { cancel: 0, now: 1 } as const;

/** Where a floating window goes, and the preload its page gets. */
export interface FloatingWindowOptions {
	readonly bounds: Electron.Rectangle;
	/** The preload bundle beside the main process's. */
	readonly preload: string;
	/** Whether the person may close it with the system's shortcut. */
	readonly closable: boolean;
}

/**
 * A small window of its own, in front of everything and on every desktop,
 * on the workbench's backdrop: Liquid Glass or vibrancy on macOS, Mica on
 * Windows 11. It starts hidden; its owner loads its page and shows it.
 */
export function createFloatingWindow(options: FloatingWindowOptions): { readonly window: BrowserWindow; readonly backdrop: WindowMaterial } {
	const material = resolveWindowMaterial(windowPlatform, release(), nativeTheme.prefersReducedTransparency, nativeTheme.shouldUseHighContrastColors);
	const window = new BrowserWindow({
		...options.bounds,
		show: false,
		// macOS keeps its frame, for the system's rounded corners, edge and shadow
		// around the glass, with the title bar and its buttons hidden.
		...isMacintosh ? { titleBarStyle: 'hidden' as const } : { frame: false },
		// As in `defaultBrowserWindowOptions`: glass shows only through a non-opaque window.
		transparent: isMacintosh && resolveWindowMaterial(windowPlatform, release(), false, false) === 'glass',
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		closable: options.closable,
		alwaysOnTop: true,
		title: product.name,
		backgroundColor: material !== 'none' ? '#00000000' : getWindowColors(nativeTheme.shouldUseDarkColors).raisedBackground,
		webPreferences: {
			preload: join(__dirname, options.preload),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webviewTag: false,
			spellcheck: false,
		},
	});
	if (isMacintosh) {
		window.setWindowButtonVisibility(false);
	}
	window.setAlwaysOnTop(true, 'floating');
	window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	window.removeMenu();
	return { window, backdrop: new WindowMaterial(window) };
}

/**
 * Shows the notice in a floating window on the screen with the pointer. It
 * answers only to its own page, and closes when its signal aborts.
 */
export const windowPrompt: NoticePrompt = (content: NoticeContent, signal: AbortSignal) => new Promise<number | undefined>(resolve => {
	if (signal.aborted) {
		resolve(undefined);
		return;
	}
	const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
	const { window, backdrop } = createFloatingWindow({
		bounds: { width, height, x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 3) },
		preload: 'noticePreload.cjs',
		// Only an answer closes it; a stray Command-W must not dismiss the countdown.
		closable: false,
	});
	let settled = false;
	const finish = (answer: number | undefined): void => {
		if (settled) {
			return;
		}
		settled = true;
		signal.removeEventListener('abort', abort);
		backdrop.dispose();
		if (!window.isDestroyed()) {
			window.destroy();
		}
		resolve(answer);
	};
	const abort = (): void => {
		finish(undefined);
	};
	signal.addEventListener('abort', abort);
	const contents = window.webContents;
	contents.ipc.on(NOTICE_RESPOND_CHANNEL, (event, answer: unknown) => {
		// Only this window's own page answers.
		if (event.senderFrame !== contents.mainFrame || event.senderFrame.url !== NOTICE_URL || !isNoticeAnswer(answer)) {
			return;
		}
		finish(answers[answer]);
	});
	const sendMaterial = (): void => {
		if (!contents.isDestroyed()) {
			contents.send(NOTICE_MATERIAL_CHANNEL, backdrop.material);
		}
	};
	backdrop.onDidChange(sendMaterial);
	contents.once('did-finish-load', () => {
		sendMaterial();
		contents.send(NOTICE_SHOW_CHANNEL, content);
		if (isMacintosh) {
			app.focus({ steal: true });
		}
		window.show();
		window.focus();
	});
	window.once('closed', () => {
		finish(undefined);
	});
	void window.loadURL(NOTICE_URL).catch(() => {
		finish(undefined);
	});
});
