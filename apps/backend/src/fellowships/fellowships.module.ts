import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Fellowship } from '@/entities/fellowship.entity';
import { APITask } from '@/entities/api-task.entity';
import { FellowshipsService } from '@/fellowships/fellowships.service';
import { FellowshipsController } from '@/fellowships/fellowships.controller';
import { FellowshipDocumentsModule } from '@/fellowship-documents/fellowship-documents.module';
import { DbTransactionModule } from '@/db-transaction/db-transaction.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Fellowship, APITask]),
        FellowshipDocumentsModule,
        DbTransactionModule,
    ],
    providers: [FellowshipsService],
    controllers: [FellowshipsController],
    exports: [FellowshipsService],
})
export class FellowshipsModule {}
