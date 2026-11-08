// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

/** Entry of the connected-computers window; see `platform/hosting/browser/indicatorPage.ts`. */
import { mainWindow } from './base/browser/window.js';
import { IndicatorPage, type IndicatorBridge } from './platform/hosting/browser/indicatorPage.js';

const bridge: unknown = Reflect.get(mainWindow, 'vnilinkIndicator');

if (typeof bridge === 'object' && bridge !== null) {
	new IndicatorPage(mainWindow.document.body, bridge as IndicatorBridge);
}
