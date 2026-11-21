import { Module } from '@nestjs/common';
import { GeoIpService } from '@/geoip/geoip.service';

@Module({
    providers: [GeoIpService],
    exports: [GeoIpService],
})
export class GeoIpModule {}
