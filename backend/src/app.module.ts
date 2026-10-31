import { Module } from '@nestjs/common';

import { KernelModule } from './kernel/kernel.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ListingsModule } from './modules/listings/listings.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { GameAccountsModule } from './modules/game-accounts/game-accounts.module';
import { ChatModule } from './modules/chat/chat.module';
import { TrustModule } from './modules/trust/trust.module';

// One NestJS application: the kernel first, then the seven unit modules in unit order
// (BUILDING.md section 3; docs/design/09_integration.pdf, section 2).
@Module({
  imports: [
    KernelModule,
    IdentityModule,
    OrdersModule,
    ListingsModule,
    DeliveryModule,
    GameAccountsModule,
    ChatModule,
    TrustModule,
  ],
})
export class AppModule {}
