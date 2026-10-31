import { Provider } from '@nestjs/common';
import { config } from './config';

// The configuration as a Nest provider: inject it with @Inject(TB_CONFIG) config: TbConfig.
export const TB_CONFIG = Symbol('TB_CONFIG');

export const configProvider: Provider = { provide: TB_CONFIG, useFactory: config };
