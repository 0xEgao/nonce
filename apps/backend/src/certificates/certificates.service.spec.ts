import { BadRequestException } from '@nestjs/common';
import * as AdmZip from 'adm-zip';
import { CertificatesService } from '@/certificates/certificates.service';
import { CohortType } from '@/common/enum';
import { generateCertificateFileName } from '@/certificates/certificates.utils';

function buildService(options: {
    certificates: unknown[];
    generate: (certificate: { id: string }) => Promise<Buffer>;
}): CertificatesService {
    const certificateRepository = {
        find: jest.fn().mockResolvedValue(options.certificates),
    };
    const certificatesGenerationService = {
        generateCertificateFromEntity: jest.fn(options.generate),
    };
    return new CertificatesService(
        {} as never,
        certificateRepository as never,
        {} as never,
        {} as never,
        certificatesGenerationService as never,
        {} as never,
        {} as never,
    );
}

function certificateFor(id: string) {
    return {
        id,
        user: { id: `user-${id}` },
        cohort: { type: CohortType.MASTERING_BITCOIN, season: 4 },
    };
}

async function readAll(stream: {
    getStream(): NodeJS.ReadableStream;
}): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream.getStream()) {
        chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks);
}

describe('CertificatesService.bulkDownloadCohortCertificates', () => {
    it('zips one PDF per certificate under its generated file name', async () => {
        const pdfs: Record<string, Buffer> = {
            a: Buffer.from('%PDF-1.7 certificate a'),
            b: Buffer.from('%PDF-1.7 certificate b'),
        };
        const service = buildService({
            certificates: [certificateFor('a'), certificateFor('b')],
            generate: async (certificate) => pdfs[certificate.id],
        });

        const { fileName, fileStream } =
            await service.bulkDownloadCohortCertificates('cohort-1');

        expect(fileName).toBe('certificates_mastering_bitcoin_s4.zip');
        const zip = new AdmZip(await readAll(fileStream));
        const names = zip
            .getEntries()
            .map((e) => e.entryName)
            .sort();
        expect(names).toEqual(
            [
                generateCertificateFileName(
                    'user-a',
                    CohortType.MASTERING_BITCOIN,
                ),
                generateCertificateFileName(
                    'user-b',
                    CohortType.MASTERING_BITCOIN,
                ),
            ].sort(),
        );
        expect(
            zip
                .readFile(
                    generateCertificateFileName(
                        'user-a',
                        CohortType.MASTERING_BITCOIN,
                    ),
                )
                ?.equals(pdfs.a),
        ).toBe(true);
    });

    it('skips certificates whose PDF failed to generate', async () => {
        const service = buildService({
            certificates: [certificateFor('a'), certificateFor('b')],
            generate: async (certificate) => {
                if (certificate.id === 'b') {
                    throw new Error('render failed');
                }
                return Buffer.from('%PDF-1.7 certificate a');
            },
        });

        const { fileStream } =
            await service.bulkDownloadCohortCertificates('cohort-1');

        const zip = new AdmZip(await readAll(fileStream));
        expect(zip.getEntries().map((e) => e.entryName)).toEqual([
            generateCertificateFileName('user-a', CohortType.MASTERING_BITCOIN),
        ]);
    });

    it('rejects when no certificate could be generated', async () => {
        const service = buildService({
            certificates: [certificateFor('a')],
            generate: async () => {
                throw new Error('render failed');
            },
        });

        await expect(
            service.bulkDownloadCohortCertificates('cohort-1'),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the cohort has no certificates', async () => {
        const service = buildService({
            certificates: [],
            generate: async () => Buffer.alloc(0),
        });

        await expect(
            service.bulkDownloadCohortCertificates('cohort-1'),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
