/**
 * ProjectController — thin orchestration (§7.3). Receives validated input +
 * server-derived owner context, calls the service, shapes the response via the
 * shared builders. No business logic, no DB access. Mirrors
 * InterviewSessionController / TicketController (§6.1).
 */
import type { Request, Response } from "express";
import { requireOwner } from "../../middleware/ownerContext";
import type {
  CreateProjectBody,
  ProjectIdParam,
  UpdateProjectBody,
} from "../../validation/project";
import type {
  ApplyResolutionsBody,
  BitIdParam,
  CandidateBitBody,
  ImportBitsBody,
  ReconcileBitsBody,
  UpdateBitBody,
} from "../../validation/projectBit";
import { BitReconciliationService } from "./feature-services/BitReconciliationService";
import { ProjectBitService } from "./feature-services/ProjectBitService";
import { ProjectService } from "./feature-services/ProjectService";
import { buildBitPrompt } from "./feature-utils/bitPromptTemplate";
import { handleError, ok } from "./feature-utils/controllerResponses";

export class ProjectController {
  /** POST /projects — create a project → 201. */
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const body = req.body as CreateProjectBody;
      const project = await ProjectService.createProject(owner, body);
      return ok(res, project, 201);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** GET /projects — the caller's projects, newest first → 200. */
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const projects = await ProjectService.listProjects(owner);
      return ok(res, projects);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** GET /projects/:id — fetch a project the caller owns → 200. */
  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      const detail = await ProjectService.getProjectWithBits(id, owner);
      return ok(res, detail);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** PATCH /projects/:id — update a project the caller owns → 200. */
  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      const body = req.body as UpdateProjectBody;
      const project = await ProjectService.updateProject(id, owner, body);
      return ok(res, project);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** DELETE /projects/:id — delete a project the caller owns → 200 (children cascade). */
  static async remove(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      const deleted = await ProjectService.deleteProject(id, owner);
      return ok(res, deleted, 200);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** GET /projects/:id/bits — bits for an owner-verified project → 200. */
  static async listBits(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      const bits = await ProjectBitService.listBits(id, owner);
      return ok(res, bits);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** POST /projects/:id/bits — create a manual bit on an owner-verified project → 201. */
  static async createBit(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      const body = req.body as CandidateBitBody;
      const bit = await ProjectBitService.createBit(id, owner, body);
      return ok(res, bit, 201);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** PATCH /projects/:id/bits/:bitId — update a bit on an owner-verified project → 200. */
  static async updateBit(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id, bitId } = req.params as unknown as BitIdParam;
      const body = req.body as UpdateBitBody;
      const bit = await ProjectBitService.updateBit(id, bitId, owner, body);
      return ok(res, bit);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /** DELETE /projects/:id/bits/:bitId — delete a bit on an owner-verified project → 200. */
  static async removeBit(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id, bitId } = req.params as unknown as BitIdParam;
      const deleted = await ProjectBitService.deleteBit(id, bitId, owner);
      return ok(res, deleted, 200);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /**
   * POST /projects/:id/bits/reconcile — plan a reconciliation for a batch of
   * candidates against the project's existing bits (spec T9). Read-only: returns
   * the agent's plan (no writes), which the resolve screen then disposes → 200.
   */
  static async reconcileBits(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      const body = req.body as ReconcileBitsBody;
      const plan = await BitReconciliationService.reconcile(id, owner, body.candidates);
      return ok(res, plan);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /**
   * POST /projects/:id/bits/apply — apply the human-confirmed resolutions for a
   * batch of candidates, atomically (spec T9, §10.5). Returns the project's
   * resulting ACTIVE bits → 200.
   */
  static async applyBits(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      const body = req.body as ApplyResolutionsBody;
      const bits = await BitReconciliationService.applyResolutions(
        id,
        owner,
        body.candidates,
        body.resolutions,
      );
      return ok(res, bits);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /**
   * POST /projects/:id/bits/import — import a batch of bits from an uploaded JSON
   * file (spec T10). Additive by DEFAULT: the bits are routed through reconcile()
   * and the plan is returned for preview-then-confirm (nothing is written). When
   * `force` is true, the project's bits are cleared and replaced in one
   * transaction and the applied bits are returned — the ONLY path that clears.
   * The response shape differs by mode, so the controller tags it with `mode`.
   */
  static async importBits(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      const body = req.body as ImportBitsBody;
      const result = await BitReconciliationService.importBits(
        id,
        owner,
        body.bits,
        body.force,
      );
      return ok(res, result);
    } catch (error) {
      return handleError(res, error);
    }
  }

  /**
   * GET /projects/:id/bit-prompt — the server-owned generate-bits prompt for an
   * owner-verified project (spec T10). Embeds the EXACT import JSON schema so the
   * separate Claude Code session emits an uploadable file → 200.
   */
  static async getBitPrompt(req: Request, res: Response): Promise<Response> {
    try {
      const owner = requireOwner(req);
      const { id } = req.params as unknown as ProjectIdParam;
      // Owner-verify and fetch the name through the service (the controller never
      // touches the model directly, §7.3); the template is a pure builder.
      const project = await ProjectService.getProjectForOwner(id, owner);
      return ok(res, { prompt: buildBitPrompt(project.name) });
    } catch (error) {
      return handleError(res, error);
    }
  }
}
