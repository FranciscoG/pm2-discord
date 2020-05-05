
export interface DiscordMessage {
  name: string,
  event: string,
  description: string,
  buffer?: string[],
  timestamp?: Number
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

export interface SchedulerConfig {
  /**
   * Postponing time. If it is zero, the callback is always executed immediately.
   */
  buffer_seconds: number,

  /**
   * If is defined, postponning is limited to this total time.
   * So when the new postponings are request and it will exceed this value, it will be ignored. 
   */
  buffer_max_seconds?: number
}

export interface MessageQueueConfig {
  buffer?: boolean,
  buffer_seconds?: number,
  buffer_max_seconds?: number,
  queue_max?: number,
}

export interface LogMessage{
  description: string|null,
  timestamp: number|null
}

//const configProperties = ['username', 'servername', 'buffer', 'slack_url', 'buffer_seconds', 'buffer_max_seconds', 'queue_max'];
export interface SomeConfig extends MessageQueueConfig {
  username?: string,
  servername?: string,
  discord_url?: string,
}