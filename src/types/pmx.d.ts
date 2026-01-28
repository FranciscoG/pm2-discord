declare module 'pmx' {
  interface PmxOptions {
    widget?: {
      type?: string;
      theme?: string;
      el?: string;
    };
    probe?: boolean;
    network?: boolean;
    ports?: boolean;
    ignore_probes?: string[];
  }
  type Pm2Config = Record<string, string | number | boolean | undefined | null>
  // src https://github.com/keymetrics/pmx/blob/v1.6.8/lib/pmx.js
  function initModule(opts: PmxOptions | null, cb: (err: Error | null, data: Pm2Config) => void): Pm2Config
}
