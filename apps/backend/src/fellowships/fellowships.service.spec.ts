import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { EntityManager, LessThan } from 'typeorm';
import { FellowshipsService } from '@/fellowships/fellowships.service';
import { FellowshipResponseDto } from '@/fellowships/fellowships.response.dto';
import { Fellowship } from '@/entities/fellowship.entity';
import { APITask } from '@/entities/api-task.entity';
import { TaskType } from '@/task-processor/task.enums';
import { DbTransactionService } from '@/db-transaction/db-transaction.service';
import {
    FellowshipStatus,
    FellowshipType,
    FellowshipKind,
} from '@/common/enum';

// Covers startContract's endDate handling: the submitted endDate must be
// after startDate, cannot be more than 24 months from today, and (now that
// the backend no longer derives it from a duration) the submitted endDate is
// what gets persisted verbatim.
describe('FellowshipsService — startContract', () => {
    let service: FellowshipsService;

    const fellowship = {
        id: 'fellowship-1',
        status: FellowshipStatus.DOCUMENTS_APPROVED,
        user: { id: 'user-1', displayName: 'Alice', location: 'Remote' },
        application: {
            id: 'app-1',
            mentorContact: 'mentor',
            projectName: 'Project',
            github: 'alice',
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
    };

    const manager = {
        findOne: jest.fn(),
        update: jest.fn(),
    };

    const dbTransactionService = {
        execute: jest.fn((fn: (m: EntityManager) => Promise<unknown>) =>
            fn(manager as unknown as EntityManager),
        ),
    };

    const fellowshipRepository = {
        findOne: jest.fn(),
    };

    const apiTaskRepository = { save: jest.fn() };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FellowshipsService,
                {
                    provide: getRepositoryToken(Fellowship),
                    useValue: fellowshipRepository,
                },
                {
                    provide: getRepositoryToken(APITask),
                    useValue: apiTaskRepository,
                },
                {
                    provide: DbTransactionService,
                    useValue: dbTransactionService,
                },
            ],
        }).compile();

        service = module.get(FellowshipsService);

        dbTransactionService.execute.mockImplementation(
            (fn: (m: EntityManager) => Promise<unknown>) =>
                fn(manager as unknown as EntityManager),
        );
        fellowshipRepository.findOne.mockResolvedValue({ ...fellowship });
        manager.findOne.mockResolvedValue({ ...fellowship });
    });

    afterEach(() => jest.resetAllMocks());

    it('rejects an endDate that is not after startDate', async () => {
        await expect(
            service.startContract('fellowship-1', {
                startDate: '2026-01-01',
                endDate: '2026-01-01',
                amountUsd: 500,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(manager.update).not.toHaveBeenCalled();
    });

    it('rejects an endDate more than 24 months from today', async () => {
        const start = new Date();
        const tooFar = new Date();
        tooFar.setUTCMonth(tooFar.getUTCMonth() + 25);
        await expect(
            service.startContract('fellowship-1', {
                startDate: start.toISOString().slice(0, 10),
                endDate: tooFar.toISOString().slice(0, 10),
                amountUsd: 500,
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(manager.update).not.toHaveBeenCalled();
    });

    it('persists the submitted startDate/endDate verbatim', async () => {
        await service.startContract('fellowship-1', {
            startDate: '2026-01-01',
            endDate: '2026-07-15',
            amountUsd: 500,
        });

        expect(manager.update).toHaveBeenCalledWith(
            Fellowship,
            'fellowship-1',
            expect.objectContaining({
                startDate: new Date('2026-01-01'),
                endDate: new Date('2026-07-15'),
                status: FellowshipStatus.ACTIVE,
            }),
        );
    });
});

// Ending early must only move ACTIVE rows, must decide the status under the
// row lock (not from the pre-lock read), and must never push endDate later.
describe('FellowshipsService — endFellowshipEarly', () => {
    let service: FellowshipsService;

    const now = new Date('2026-11-23T10:00:00Z');

    const fellowship = {
        id: 'fellowship-1',
        status: FellowshipStatus.ACTIVE,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2027-05-31'),
        user: { id: 'user-1', displayName: 'Alice', location: 'Remote' },
        application: { id: 'app-1', github: 'alice' },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
    };

    const manager = { findOne: jest.fn(), update: jest.fn() };
    const dbTransactionService = { execute: jest.fn() };
    const fellowshipRepository = { findOne: jest.fn() };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FellowshipsService,
                {
                    provide: getRepositoryToken(Fellowship),
                    useValue: fellowshipRepository,
                },
                {
                    provide: getRepositoryToken(APITask),
                    useValue: { save: jest.fn() },
                },
                {
                    provide: DbTransactionService,
                    useValue: dbTransactionService,
                },
            ],
        }).compile();

        service = module.get(FellowshipsService);

        dbTransactionService.execute.mockImplementation(
            (fn: (m: EntityManager) => Promise<unknown>) =>
                fn(manager as unknown as EntityManager),
        );
        fellowshipRepository.findOne.mockResolvedValue({ ...fellowship });
        manager.findOne.mockResolvedValue({ ...fellowship });
    });

    afterEach(() => jest.resetAllMocks());

    it('moves an ACTIVE fellowship to COMPLETED with endDate = now', async () => {
        const result = await service.endFellowshipEarly('fellowship-1', now);

        expect(manager.findOne).toHaveBeenCalledWith(
            Fellowship,
            expect.objectContaining({
                lock: { mode: 'pessimistic_write' },
            }),
        );
        expect(manager.update).toHaveBeenCalledWith(
            Fellowship,
            'fellowship-1',
            { endDate: now, status: FellowshipStatus.COMPLETED },
        );
        expect(result.status).toBe(FellowshipStatus.COMPLETED);
        expect(result.endDate).toBe(now.toISOString());
    });

    it('keeps an endDate that has already passed instead of moving it later', async () => {
        const passed = new Date('2026-11-20T00:00:00Z');
        manager.findOne.mockResolvedValue({ ...fellowship, endDate: passed });

        await service.endFellowshipEarly('fellowship-1', now);

        expect(manager.update).toHaveBeenCalledWith(
            Fellowship,
            'fellowship-1',
            { endDate: passed, status: FellowshipStatus.COMPLETED },
        );
    });

    it('rejects a fellowship that became COMPLETED before the lock was taken', async () => {
        manager.findOne.mockResolvedValue({
            ...fellowship,
            status: FellowshipStatus.COMPLETED,
        });

        await expect(
            service.endFellowshipEarly('fellowship-1', now),
        ).rejects.toThrow('Fellowship has already ended');
        expect(manager.update).not.toHaveBeenCalled();
    });

    it('rejects a fellowship whose contract has not started', async () => {
        manager.findOne.mockResolvedValue({
            ...fellowship,
            status: FellowshipStatus.DOCUMENTS_APPROVED,
        });

        await expect(
            service.endFellowshipEarly('fellowship-1', now),
        ).rejects.toThrow(BadRequestException);
        expect(manager.update).not.toHaveBeenCalled();
    });

    it('404s an unknown fellowship', async () => {
        fellowshipRepository.findOne.mockResolvedValue(null);

        await expect(
            service.endFellowshipEarly('missing', now),
        ).rejects.toThrow('Fellowship not found');
        expect(dbTransactionService.execute).not.toHaveBeenCalled();
    });
});

describe('FellowshipsService — listPublicFellows', () => {
    let service: FellowshipsService;

    // type is deliberately different on the fellowship root vs. the joined
    // application row, so the serialization test below can catch a regression
    // back to reading type from the wrong side of the join.
    const fellowship = {
        id: 'fellowship-1',
        type: FellowshipType.DEVELOPER,
        kind: FellowshipKind.STARTER_GRANT,
        status: FellowshipStatus.ACTIVE,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        user: {
            id: 'user-1',
            displayName: 'Alice',
            githubProfileUrl: 'https://github.com/alice',
            location: 'Remote',
            email: 'alice@example.com',
        },
        application: {
            id: 'app-1',
            type: FellowshipType.DESIGNER,
            projectName: 'Project',
            projectGithubLink: 'https://github.com/alice/project',
            mentorContact: 'mentor@example.com',
            academicBackground: 'CS degree',
            bitcoinMotivation: 'Because Bitcoin',
        },
    };

    const fellowshipRepository = {
        findAndCount: jest.fn(),
    };

    const apiTaskRepository = { save: jest.fn() };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FellowshipsService,
                {
                    provide: getRepositoryToken(Fellowship),
                    useValue: fellowshipRepository,
                },
                {
                    provide: getRepositoryToken(APITask),
                    useValue: apiTaskRepository,
                },
                {
                    provide: DbTransactionService,
                    useValue: { execute: jest.fn() },
                },
            ],
        }).compile();

        service = module.get(FellowshipsService);
    });

    afterEach(() => jest.resetAllMocks());

    it('queries ACTIVE fellowships with user/application relations and pagination', async () => {
        fellowshipRepository.findAndCount.mockResolvedValue([[], 0]);

        await service.listPublicFellows({ page: 2, pageSize: 20 });

        expect(fellowshipRepository.findAndCount).toHaveBeenCalledWith({
            where: { status: FellowshipStatus.ACTIVE },
            relations: { user: true, application: true },
            order: { createdAt: 'DESC', id: 'ASC' },
            skip: 40,
            take: 20,
        });
    });

    it('serializes a fellow down to exactly the public fields, sourced from the fellowship root', async () => {
        fellowshipRepository.findAndCount.mockResolvedValue([[fellowship], 1]);

        const result = await service.listPublicFellows({
            page: 0,
            pageSize: 20,
        });

        expect({ ...result.records[0] }).toStrictEqual({
            id: fellowship.id,
            displayName: fellowship.user.displayName,
            githubProfileUrl: fellowship.user.githubProfileUrl,
            projectName: fellowship.application.projectName,
            projectGithubLink: fellowship.application.projectGithubLink,
            type: fellowship.type,
            kind: fellowship.kind,
        });
    });
});

describe('FellowshipsService — completeEndedFellowships', () => {
    let service: FellowshipsService;

    const fellowshipRepository = {
        update: jest.fn(),
    };
    const apiTaskRepository = { save: jest.fn() };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FellowshipsService,
                {
                    provide: getRepositoryToken(Fellowship),
                    useValue: fellowshipRepository,
                },
                {
                    provide: getRepositoryToken(APITask),
                    useValue: apiTaskRepository,
                },
                {
                    provide: DbTransactionService,
                    useValue: { execute: jest.fn() },
                },
            ],
        }).compile();

        service = module.get(FellowshipsService);
    });

    afterEach(() => {
        jest.resetAllMocks();
        jest.useRealTimers();
    });

    const task = (retryCount: number, retryLimit = 3) =>
        ({
            retryCount,
            retryLimit,
        }) as APITask<TaskType.COMPLETE_ENDED_FELLOWSHIPS>;

    const queuedTask = (): APITask<TaskType.COMPLETE_ENDED_FELLOWSHIPS> =>
        apiTaskRepository.save.mock.calls[0][0];

    describe('completeEndedFellowships', () => {
        it('moves only ACTIVE fellowships whose endDate is before now to COMPLETED', async () => {
            const now = new Date('2026-11-16T04:00:00Z');
            fellowshipRepository.update.mockResolvedValue({ affected: 3 });

            const completed = await service.completeEndedFellowships(now);

            expect(completed).toBe(3);
            expect(fellowshipRepository.update).toHaveBeenCalledWith(
                { status: FellowshipStatus.ACTIVE, endDate: LessThan(now) },
                { status: FellowshipStatus.COMPLETED },
            );
        });

        it('returns 0 when the driver does not report affected rows', async () => {
            fellowshipRepository.update.mockResolvedValue({});

            await expect(service.completeEndedFellowships()).resolves.toBe(0);
        });
    });

    describe('scheduleNextCompleteEndedFellowships', () => {
        it('queues the next run for 04:00 UTC the same day when it is still ahead', async () => {
            await service.scheduleNextCompleteEndedFellowships(
                new Date('2026-11-16T01:30:00Z'),
            );

            expect(queuedTask().type).toBe(TaskType.COMPLETE_ENDED_FELLOWSHIPS);
            expect(queuedTask().data).toEqual({});
            expect(queuedTask().executeOnTime).toEqual(
                new Date('2026-11-16T04:00:00Z'),
            );
        });

        it('rolls to the next day once 04:00 UTC has passed, including exactly at 04:00', async () => {
            await service.scheduleNextCompleteEndedFellowships(
                new Date('2026-11-16T04:00:00Z'),
            );
            await service.scheduleNextCompleteEndedFellowships(
                new Date('2026-11-30T05:00:00Z'),
            );

            expect(
                apiTaskRepository.save.mock.calls[0][0].executeOnTime,
            ).toEqual(new Date('2026-11-17T04:00:00Z'));
            expect(
                apiTaskRepository.save.mock.calls[1][0].executeOnTime,
            ).toEqual(new Date('2026-12-01T04:00:00Z'));
        });
    });

    describe('handleCompleteEndedFellowships', () => {
        it('sweeps, then queues exactly one next run', async () => {
            jest.useFakeTimers().setSystemTime(
                new Date('2026-11-16T04:00:05Z'),
            );
            fellowshipRepository.update.mockResolvedValue({ affected: 2 });

            await service.handleCompleteEndedFellowships(task(0));

            expect(fellowshipRepository.update).toHaveBeenCalledTimes(1);
            expect(apiTaskRepository.save).toHaveBeenCalledTimes(1);
            expect(queuedTask().executeOnTime).toEqual(
                new Date('2026-11-17T04:00:00Z'),
            );
        });

        it('rethrows without queueing the next run while retries remain', async () => {
            fellowshipRepository.update.mockRejectedValue(new Error('db down'));

            await expect(
                service.handleCompleteEndedFellowships(task(0)),
            ).rejects.toThrow('db down');

            expect(apiTaskRepository.save).not.toHaveBeenCalled();
        });

        it('queues the next run on the last failed retry so the chain survives', async () => {
            fellowshipRepository.update.mockRejectedValue(new Error('db down'));

            await expect(
                service.handleCompleteEndedFellowships(task(2)),
            ).rejects.toThrow('db down');

            expect(apiTaskRepository.save).toHaveBeenCalledTimes(1);
        });
    });
});

// The admin/fellow pages show the project title from this payload instead of
// fetching each fellowship's full proposal, so proposalTitle must mirror the
// application's proposal title.
describe('FellowshipResponseDto.fromEntity — proposalTitle', () => {
    const buildFellowship = (
        title: string | null,
        projectName: string | null,
    ) =>
        ({
            id: 'fellowship-1',
            type: FellowshipType.DEVELOPER,
            kind: FellowshipKind.FELLOWSHIP,
            status: FellowshipStatus.ACTIVE,
            startDate: null,
            endDate: null,
            amountUsd: null,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
            user: {
                id: 'user-1',
                displayName: 'Alice',
                email: 'alice@example.com',
                location: 'Remote',
            },
            application: { id: 'app-1', title, projectName },
        }) as unknown as Fellowship;

    it('exposes the application proposal title', () => {
        const dto = FellowshipResponseDto.fromEntity(
            buildFellowship('Lightning wallet', null),
        );

        expect(dto.proposalTitle).toBe('Lightning wallet');
    });

    it('keeps proposalTitle separate from projectName', () => {
        const dto = FellowshipResponseDto.fromEntity(
            buildFellowship('Lightning wallet', 'Onboarding project'),
        );

        expect(dto.proposalTitle).toBe('Lightning wallet');
        expect(dto.projectName).toBe('Onboarding project');
    });

    it('passes a missing proposal title through as null', () => {
        const dto = FellowshipResponseDto.fromEntity(
            buildFellowship(null, null),
        );

        expect(dto.proposalTitle).toBeNull();
    });
});
