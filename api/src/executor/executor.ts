import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { cfg } from '../config';
import { ActionRecord } from '../actions/actions.repo';

const run = promisify(execFile);

export interface Executor {
  /** side-effect-free preview */
  plan(a: ActionRecord): Promise<string>;
  /** must be idempotent: applying twice yields the same end state */
  apply(a: ActionRecord): Promise<void>;
  rollback(a: ActionRecord): Promise<void>;
}

/**
 * GitOps-style Terraform runner: TERRAFORM_DIR holds the already-reviewed config; the proposal's
 * `terraform_target` scopes plan/apply to the one resource. `terraform apply` is naturally idempotent.
 * Rollback runs ROLLBACK_COMMAND (e.g. a script re-applying the previous revision) when configured.
 */
@Injectable()
export class TerraformExecutor implements Executor {
  private tf = (args: string[]) => run('terraform', args, { cwd: cfg().terraformDir, timeout: 15 * 60_000, env: process.env });
  private target = (a: ActionRecord) => (a.proposal.terraform_target ? [`-target=${a.proposal.terraform_target}`] : []);

  async plan(a: ActionRecord) {
    const { stdout } = await this.tf(['plan', '-no-color', '-input=false', '-lock=false', ...this.target(a)]);
    return stdout;
  }
  async apply(a: ActionRecord) {
    await this.tf(['apply', '-no-color', '-input=false', '-auto-approve', ...this.target(a)]);
  }
  async rollback(a: ActionRecord) {
    const cmd = process.env.ROLLBACK_COMMAND;
    if (cmd) await run(cmd, [a.proposal.terraform_target ?? ''], { cwd: cfg().terraformDir, env: process.env });
    else throw new Error('no ROLLBACK_COMMAND configured');
  }
}

/** Default when TERRAFORM_DIR is unset: validates and records the change but touches nothing. */
@Injectable()
export class SimulatedExecutor implements Executor {
  applied = new Set<string>();
  async plan(a: ActionRecord) { return a.proposal.terraform_diff ?? ''; }
  async apply(a: ActionRecord) { this.applied.add(a.id); }
  async rollback(a: ActionRecord) { this.applied.delete(a.id); }
}

export const EXECUTOR = 'EXECUTOR';
export const executorProvider = {
  provide: EXECUTOR,
  useFactory: (): Executor => (cfg().terraformDir ? new TerraformExecutor() : new SimulatedExecutor()),
};

@Injectable()
export class HealthChecker {
  /** Probes the service after apply. Unconfigured => assume healthy (simulated environments). */
  async check(resourceId: string): Promise<boolean> {
    const tpl = cfg().healthcheckUrlTemplate;
    if (!tpl) return true;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(tpl.replace('{resource}', encodeURIComponent(resourceId)), { signal: AbortSignal.timeout(5000) });
        if (r.ok) return true;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
    return false;
  }
}
