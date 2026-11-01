import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { ConfigPort, ConfigValues, ParameterValues, parameterValues, SwitchName } from '../../../kernel/config-port';

// ConfigPort over the versioned parameter set (Unit 7 section "Parameters and Feature Switches"; FR-OPS-08,
// DV-50). current() is cached per instance and refreshed at least every 60 seconds, and at once after this
// instance publishes; a new order may use the previous version for up to a minute, which is acceptable
// because every order keeps the version it was created with. Versions never change, so atVersion() caches
// them for good. The emergency switches are always read from the database (switchOn).
export const CACHE_MS = 60_000; // DV-50

@Injectable()
export class ConfigService implements ConfigPort {
  private cached: { values: ConfigValues; at: number } | undefined;
  private readonly versions = new Map<number, ParameterValues>();

  constructor(
    private readonly db: DataSource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async current(): Promise<ConfigValues> {
    const now = this.clock.now().getTime();
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.values;
    const [{ version }] = await this.db.query(`SELECT staff.current_config_version() AS version`);
    const values: ConfigValues = { version, ...(await this.atVersion(version)) };
    this.cached = { values, at: now };
    return values;
  }

  async atVersion(version: number): Promise<ParameterValues> {
    const known = this.versions.get(version);
    if (known) return known;
    const [{ set }] = await this.db.query(`SELECT staff.config_as_json($1) AS set`, [version]);
    if (!set || Object.keys(set).length === 0) throw new Error(`parameter version ${version} does not exist`);
    const values = parameterValues(set);
    this.versions.set(version, values);
    return values;
  }

  /** SEC-IRM-04: never cached, so stopping new orders or payouts takes effect at once. */
  async switchOn(name: SwitchName): Promise<boolean> {
    const [r] = await this.db.query(
      `SELECT value FROM staff.config_values WHERE version = staff.current_config_version() AND code = $1`,
      [name],
    );
    return r?.value === true;
  }

  /** After a publication by this instance; other instances refresh within DV-50 (or on staff.config.published, K-04). */
  invalidate(): void {
    this.cached = undefined;
  }
}
