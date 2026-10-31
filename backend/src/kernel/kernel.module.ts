import { Module } from '@nestjs/common';

// The shared kernel (docs/design/09_integration.pdf, section 2): configuration and secrets (K-01),
// logging (K-02), health (K-03), the outbox dispatcher (K-04), the job runner (K-05), metrics and
// shutdown (K-06), the Socket.IO gateway (K-07) and the problem+json error format.
// The kernel never imports a unit module; units import the kernel.
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class KernelModule {}
