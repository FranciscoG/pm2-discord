import type { SchedulerConfig } from './types/index';

/**
 * Allows you to set the min and max wait time for executing a callback function
 */
class Scheduler {
  private minTimeout: NodeJS.Timeout
  private maxTimeout: NodeJS.Timeout
  private currentCallback: Function | null
  config: SchedulerConfig;

  /**
   * @param {object} config 
   * @param {number} config.buffer_seconds mininum time to call a function
   * @param {number} config.buffer_max_seconds max time to call a function
   */
  constructor(config: SchedulerConfig) {
    this.config = config;
  }

  clear() {
    this.currentCallback = null;

    if (this.minTimeout) {
      clearTimeout(this.minTimeout);
    }
    if (this.maxTimeout) {
      clearTimeout(this.maxTimeout);
    }
  }

  /**
   * Schedule the calling of a function. Everytime you call this it will replace
   * the previously scheduled callback function with the new one and if min timer
   * hasn't expired it will clear it and start a new one.
   * @param callback 
   */
  schedule(callback: Function) {
    const { buffer_max_seconds, buffer_seconds } = this.config;
    this.currentCallback = callback;

    // the minium timeout will constantly get replaced every time you call "schedule"
    if (this.minTimeout) {
      clearTimeout(this.minTimeout);
    }
    this.minTimeout = setTimeout(() => {
      clearTimeout(this.maxTimeout);
      if (this.currentCallback) {
        this.currentCallback();
        this.currentCallback = null;
      }
    }, buffer_seconds * 1000);

    // maxTimeout only gets set once and can only be replaced if it expires OR
    // if the minTimeout expires
    if (!this.maxTimeout) {
      this.maxTimeout = setTimeout(() => {
        clearTimeout(this.minTimeout);
        if (this.currentCallback) {
          this.currentCallback();
          this.currentCallback = null;
        }
      }, buffer_max_seconds * 1000);
    }
  }
}

export default Scheduler;
