import { FunctionWorker } from '@prisma/client';
import { prisma } from '../_client.js';
import { WorkerCronRunner } from './cronRunner.js';
import { logger } from '../../utils/logger.js';

export type WorkerCronUpsertData = Pick<
  FunctionWorker,
  'workspaceId' | 'name' | 'code' | 'enableCron' | 'cronExpression'
> & {
  id?: string;
  active?: boolean;
  description?: string;
};

export class WorkerCronManager {
  private workerRunners: Record<string, WorkerCronRunner> = {};
  private isStarted = false;

  /**
   * Create or update worker cron job
   */
  async upsert(data: WorkerCronUpsertData): Promise<FunctionWorker> {
    let worker: FunctionWorker;
    const { id, workspaceId, ...others } = data;

    if (id) {
      // update
      worker = await prisma.functionWorker.update({
        where: {
          id,
          workspaceId,
        },
        data: others,
      });
    } else {
      // create
      worker = await prisma.functionWorker.create({
        data: {
          ...others,
          workspaceId,
        },
      });
    }

    // Stop and remove old runner if exists
    if (this.workerRunners[worker.id]) {
      this.workerRunners[worker.id].stopCron();
      delete this.workerRunners[worker.id];
    }

    // Create new runner if cron is enabled
    if (worker.active && worker.enableCron && worker.cronExpression) {
      const runner = await this.createRunner(worker);
      runner.startCron();
    }

    return worker;
  }

  async delete(workspaceId: string, workerId: string) {
    const runner = this.getRunner(workerId);
    if (runner) {
      runner.stopCron();
      delete this.workerRunners[workerId];
    }

    return prisma.functionWorker.delete({
      where: {
        workspaceId,
        id: workerId,
      },
    });
  }

  /**
   * Get and start all worker cron jobs
   */
  async startAll() {
    if (this.isStarted === true) {
      logger.warn('WorkerCronManager.startAll should only call once, skipped.');
      return;
    }

    this.isStarted = true;

    const workers = await prisma.functionWorker.findMany({
      where: {
        active: true,
        enableCron: true,
        cronExpression: {
          not: null,
        },
      },
    });

    Promise.all(
      workers.map(async (worker) => {
        try {
          const runner = await this.createRunner(worker);
          this.workerRunners[worker.id] = runner;
          await runner.startCron();
        } catch (err) {
          logger.error('Start worker cron error:', String(err));
        }
      })
    ).then(() => {
      logger.info(`Started ${workers.length} worker cron jobs.`);
    });
  }

  getRunner(workerId: string): WorkerCronRunner | undefined {
    return this.workerRunners[workerId];
  }

  /**
   * Restart all runners based on workspace id
   */
  restartWithWorkspaceId(workspaceId: string) {
    Object.values(this.workerRunners).map((runner) => {
      if (runner.workspace.id === workspaceId) {
        this.createRunner(runner.worker);
      }
    });
  }

  /**
   * Create runner
   */
  async createRunner(worker: FunctionWorker) {
    if (this.workerRunners[worker.id]) {
      this.workerRunners[worker.id].stopCron();
    }

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: {
        id: worker.workspaceId,
      },
    });

    const runner = (this.workerRunners[worker.id] = new WorkerCronRunner(
      workspace,
      worker
    ));

    return runner;
  }

  /**
   * Ensure runner has been created
   */
  async ensureRunner(workspaceId: string, workerId: string) {
    const runner = this.getRunner(workerId);
    if (runner) {
      return runner;
    }

    const worker = await prisma.functionWorker.findUnique({
      where: {
        id: workerId,
        workspaceId,
      },
    });

    if (!worker) {
      throw new Error('Worker not found');
    }

    if (!worker.active) {
      throw new Error('Worker is not active');
    }

    if (!worker.enableCron || !worker.cronExpression) {
      throw new Error(
        'Worker cron is not enabled or no cron expression provided'
      );
    }

    return this.createRunner(worker);
  }

  /**
   * Stop all cron jobs
   */
  stopAll() {
    Object.values(this.workerRunners).forEach((runner) => {
      runner.stopCron();
    });
    this.workerRunners = {};
    logger.info('All worker cron jobs stopped.');
  }
}
