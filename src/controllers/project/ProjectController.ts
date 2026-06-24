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
  BitIdParam,
  CandidateBitBody,
  UpdateBitBody,
} from "../../validation/projectBit";
import { ProjectBitService } from "./feature-services/ProjectBitService";
import { ProjectService } from "./feature-services/ProjectService";
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
      const project = await ProjectService.getProjectForOwner(id, owner);
      return ok(res, project);
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
}
