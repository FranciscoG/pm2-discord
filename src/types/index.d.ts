
export interface DiscordMessage {
  name: string,
  event: string,
  description: string|null,
  buffer?: string[],
  timestamp: number|null
}

export interface Process {
  name: string,
  exec_mode: string,
  instances: number,
  pm_id: string|number
}

// data.process.name
export interface BusData {
  process: Process,
  data?: string
}

export interface BaseConfig {
  /**
   * Postponing time. If it is zero, the callback is always executed immediately.
   */
  buffer_seconds: number,
  /**
   * If is defined, postponning is limited to this total time.
   * So when new postpones are requested and it will exceed this value, it will be ignored. 
   */
  buffer_max_seconds?: number
}

export interface SchedulerConfig extends BaseConfig {}

export interface MessageQueueConfig extends BaseConfig {
  buffer: boolean,
  queue_max: number
  discord_url?: string
}

export interface LogMessage{
  description: string|null,
  timestamp: number|null
}

export interface SendToDiscord {
  (messages: DiscordMessage[], config: MessageQueueConfig): void
}