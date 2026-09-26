import { TypeOrmModuleOptions } from '@nestjs/typeorm';

// NOTE: `synchronize: true` is convenient for early scaffolding only.
// Switch to TypeORM migrations before anything resembling production data
// exists — see docs/srs.tex NFR-20 for the indexing requirements migrations
// should encode (listing_id, seller_id, buyer_id, geospatial index).
export const typeOrmConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  autoLoadEntities: true,
  synchronize: process.env.NODE_ENV !== 'production',
};
