import { SchedulerConfig } from './types/index';

/**
 * Adds ability to postpone the execution of some function.
 * If new postpone is requested, old schedule will be canceled. So max. one schedule can exists in one time.
 * 
 * Configuration:
 * 
 * - Postponing time is defined in `buffer_seconds`.
 * - 
 */
export default class Scheduler {
  private _timeoutId: NodeJS.Timeout | null
  private _totalPostponingSeconds: number = 0

  config: SchedulerConfig;

  constructor(config: SchedulerConfig) {
    this.config = config;
  }

  /**
   * Plan the postponed execution of callback function.
   * If some plan exists, it will be cancelled and replaced by the new one.
   */
  schedule(callback: Function) {
    const { buffer_max_seconds, buffer_seconds } = this.config;

    if (buffer_max_seconds &&
      (buffer_max_seconds <= this._totalPostponingSeconds + buffer_seconds)) {
      // Max buffer time reached. Do not replan sending.
      return;
    }

    // If previous sending is planned, cancel it.
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
    }

    // Plan the message sending after timeout
    this._timeoutId = setTimeout(() => {
      this._timeoutId = null;
      this._totalPostponingSeconds = 0;

      callback();
    }, buffer_seconds * 1000);

    this._totalPostponingSeconds += buffer_seconds;
  }

}
