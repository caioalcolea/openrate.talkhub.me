import { Global, Module } from '@nestjs/common';
import { PgService } from './common/pg.service';
import { S3Service } from './common/s3';
import { QueuesService } from './queues.service';

// Serviços de infraestrutura compartilhados por todos os módulos.
@Global()
@Module({
  providers: [PgService, S3Service, QueuesService],
  exports: [PgService, S3Service, QueuesService],
})
export class CoreModule {}
