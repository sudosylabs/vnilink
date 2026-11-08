// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

/**
 * Preload of the connected-computers window. It exposes four calls on the
 * window's own channels and nothing of the workbench's IPC.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { INDICATOR_ATTENTION_CHANNEL, INDICATOR_DISCONNECT_CHANNEL, INDICATOR_MATERIAL_CHANNEL, INDICATOR_SHOW_CHANNEL, isIndicatorContent, isIndicatorSessionId, type IndicatorContent } from './platform/hosting/common/indicator.js';
import { isWindowBackgroundMaterial, type WindowBackgroundMaterial } from './platform/window/common/windowMaterial.js';

if (!process.sandboxed || !process.contextIsolated) {
	throw new Error('Renderer isolation required');
}

contextBridge.exposeInMainWorld('vnilinkIndicator', {
	/** Receives what to show, now and on every change. */
	onShow(listener: (content: IndicatorContent) => void): void {
		ipcRenderer.on(INDICATOR_SHOW_CHANNEL, (_event, content: unknown) => {
			if (isIndicatorContent(content)) {
				listener(content);
			}
		});
	},
	/** Receives the window's backdrop, now and on every change. */
	onMaterial(listener: (material: WindowBackgroundMaterial) => void): void {
		ipcRenderer.on(INDICATOR_MATERIAL_CHANNEL, (_event, material: unknown) => {
			if (isWindowBackgroundMaterial(material)) {
				listener(material);
			}
		});
	},
	disconnect(sessionId: unknown): void {
		if (isIndicatorSessionId(sessionId)) {
			ipcRenderer.send(INDICATOR_DISCONNECT_CHANNEL, sessionId);
		}
	},
	attention(held: unknown): void {
		if (typeof held === 'boolean') {
			ipcRenderer.send(INDICATOR_ATTENTION_CHANNEL, held);
		}
	},
});
