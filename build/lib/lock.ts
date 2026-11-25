// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Whether a process with `pid` still runs on this computer. */
function running(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: it runs as someone else.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Leaves a newly acquired lock in place when its predecessor finishes cleaning up. */
async function removeEmpty(path: string): Promise<void> {
	try {
		await rmdir(path);
	} catch (error) {
		if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) {
			throw error;
		}
	}
}

/** Publishes a populated directory atomically. Each holder removes only its own file. */
export async function acquireLock(path: string): Promise<() => Promise<void>> {
	const stage = await mkdtemp(path + '-');
	const name = `owner-${randomUUID()}.json`;
	try {
		await writeFile(join(stage, name), JSON.stringify({ pid: process.pid }));
		for (let attempt = 0; ; attempt++) {
			try {
				await rename(stage, path);
				break;
			} catch (error) {
				if (attempt >= 8 || !['ENOTEMPTY', 'EEXIST', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
					throw error;
				}
				const entries = await readdir(path).catch((readError: unknown) => {
					if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') {
						throw readError;
					}
					return [];
				});
				for (const entry of entries) {
					if (entry !== 'owner.json' && !/^owner-[a-f0-9-]+\.json$/.test(entry)) {
						throw new Error(`Unrecognized build lock at ${path}`);
					}
					try {
						const owner = JSON.parse(await readFile(join(path, entry), 'utf8')) as { pid: number };
						if (running(owner.pid)) {
							throw new Error(`Another build (process ${String(owner.pid)}) is publishing here; wait for it, or stop it and run again (${path})`);
						}
						await unlink(join(path, entry));
					} catch (readError) {
						if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') {
							throw readError;
						}
					}
				}
				await removeEmpty(path);
			}
		}
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
	return async () => {
		await unlink(join(path, name));
		await removeEmpty(path);
	};
}
