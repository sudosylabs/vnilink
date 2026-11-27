// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import { Emitter } from '../../../base/common/event.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { engineErrorCategory, type RecordingStatus } from '../../../platform/engine/common/engine.js';
import { INativeRuntimeService } from '../nativeRuntime/nativeRuntimeService.js';

/** How often a running recording's length is read. */
const recordingPoll = 1000;

/** Why a recording of a paired computer didn't start. */
export type RecordingStartFailure = 'notAllowed' | 'disconnected' | 'failed';

/** Why a recording didn't start, from the engine's error category. */
export function recordingStartFailure(error: unknown): RecordingStartFailure {
	switch (engineErrorCategory(error) ?? '') {
		case 'Unauthorized': return 'notAllowed';
		case 'NoSession':
		case 'StaleSession': return 'disconnected';
		default: return 'failed';
	}
}

/** A recording's length as a clock shows it: `m:ss`, or `h:mm:ss` past an hour. */
export function formatElapsed(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const two = (value: number): string => String(value).padStart(2, '0');
	return hours ? `${String(hours)}:${two(minutes % 60)}:${two(seconds % 60)}` : `${String(minutes)}:${two(seconds % 60)}`;
}

/** Starts one recording of a paired computer: its id, or why it didn't start. */
type RecordingStarter = () => Promise<{ readonly failure: RecordingStartFailure } | { readonly recording: string }>;

/**
 * A tab's recording of a paired computer, one at a time: started and
 * stopped from the tab, followed until its file is finished however it
 * ends, and released then. A recording outlives its tab only long enough to
 * finish its file.
 */
export class SessionRecording extends Disposable {
	private readonly changed = this._register(new Emitter<void>());
	/** Recording, stopping or its length changed. */
	public readonly onDidChange = this.changed.event;
	private readonly ended = this._register(new Emitter<RecordingStatus | undefined>());
	/** The recording ended: its final status, or `undefined` when the engine stopped answering. */
	public readonly onDidEnd = this.ended.event;
	private readonly poll = this._register(new MutableDisposable());
	private id: string | undefined;
	private stoppingId: string | undefined;
	private length = 0;
	private unavailable = false;
	private epoch: number | undefined;

	public get statusUnavailable(): boolean {
		return this.unavailable;
	}

	private pendingStart = false;

	constructor(
		private readonly start: RecordingStarter,
		@INativeRuntimeService private readonly nativeRuntime: INativeRuntimeService,
	) {
		super();
		this._register(toDisposable(() => {
			this.poll.clear();
			if (this.id && !this.stoppingId) {
				void this.finish(this.id, true);
			}
		}));
	}

	public get starting(): boolean {
		return this.pendingStart;
	}

	public get recording(): boolean {
		return this.id !== undefined;
	}

	/** Asked to stop, and waiting for its file to be finished. */
	public get stopping(): boolean {
		return this.stoppingId !== undefined;
	}

	public get elapsedMs(): number {
		return this.length;
	}

	/** Starts a recording, or stops the running one; says why one didn't start. */
	public async toggle(): Promise<RecordingStartFailure | undefined> {
		if (this._store.isDisposed || this.pendingStart) {
			return undefined;
		}
		if (this.id) {
			await this.finish(this.id, false);
			return undefined;
		}
		this.pendingStart = true;
		this.changed.fire();
		try {
			return await this.startRecording();
		} finally {
			this.pendingStart = false;
			this.changed.fire();
		}
	}

	private async startRecording(): Promise<RecordingStartFailure | undefined> {
		const epoch = this.nativeRuntime.generation;
		const result = await this.start();
		if (epoch !== this.nativeRuntime.generation) {
			return 'disconnected';
		}
		this.epoch = epoch;
		if (this._store.isDisposed) {
			if ('recording' in result) {
				void this.finish(result.recording, true);
			}
			return undefined;
		}
		if ('failure' in result) {
			return result.failure;
		}
		this.id = result.recording;
		this.length = 0;
		this.unavailable = false;
		this.changed.fire();
		this.follow(result.recording);
		return undefined;
	}

	/** Follows the recording until its file is finished, however it ends. */
	private follow(id: string): void {
		let reading = false;
		const interval = setInterval(() => {
			if (this.epoch !== this.nativeRuntime.generation) {
				this.end(id, undefined);
				return;
			}
			if (reading) {
				return;
			}
			reading = true;
			void this.nativeRuntime.recordingStatus(id).then(status => {
				if (this.stoppingId === id || this._store.isDisposed) {
					return;
				}
				if (status.phase === 'Finished' || status.phase === 'Failed') {
					this.end(id, status);
				} else if (this.id === id) {
					this.unavailable = false;
					this.length = Number(status.durationMs);
					this.changed.fire();
				}
			}, () => {
				if (this.id === id && this.stoppingId !== id && !this._store.isDisposed) {
					this.unavailable = true;
					this.changed.fire();
				}
			}).finally(() => {
				reading = false;
			});
		}, recordingPoll);
		this.poll.value = toDisposable(() => {
			clearInterval(interval);
		});
	}

	private end(id: string, status: RecordingStatus | undefined): void {
		if (this.id !== id) {
			return;
		}
		this.id = undefined;
		this.stoppingId = undefined;
		this.poll.clear();
		this.changed.fire();
		this.ended.fire(status);
		if (status && this.epoch === this.nativeRuntime.generation) {
			void this.nativeRuntime.releaseRecording(id).catch(() => { /* The engine may have stopped. */ });
		}
	}

	/** Stops a recording and, once its file is finished, releases it. */
	private async finish(id: string, detached: boolean): Promise<void> {
		if (!detached) {
			if (this.stoppingId === id) {
				return;
			}
			this.poll.clear();
			this.stoppingId = id;
			this.changed.fire();
		}
		let stopRequested = false;
		while (this.epoch === this.nativeRuntime.generation) {
			try {
				const status = stopRequested ? await this.nativeRuntime.recordingStatus(id) : await this.nativeRuntime.stopRecording(id);
				stopRequested = true;
				if (this.epoch !== this.nativeRuntime.generation) {
					break;
				}
				if (status.phase === 'Finished' || status.phase === 'Failed') {
					if (detached || this._store.isDisposed) {
						await this.nativeRuntime.releaseRecording(id);
					} else {
						this.end(id, status);
					}
					return;
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			} catch {
				this.unavailable = true;
				this.changed.fire();
				await new Promise(resolve => setTimeout(resolve, recordingPoll));
			}
		}
		if (!detached && !this._store.isDisposed) {
			this.end(id, undefined);
		}
	}
}
