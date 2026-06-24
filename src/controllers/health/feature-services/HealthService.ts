/**
 * HealthService — business logic for the health check (§7.1). Calls the model
 * to ping the DB and returns a structured status. Never touches req/res.
 */
import { HealthModel } from "../../../models/HealthModel";

export interface HealthStatus {
  status: "ok";
  database: "up";
  timestamp: string;
}

export class HealthService {
  /**
   * Verify the service is up AND the DB answers. Throws if the ping fails, so
   * the controller returns a 500 envelope — /health is only "ok" when the DB
   * responds (spec T6 verify).
   */
  static async check(): Promise<HealthStatus> {
    const dbUp = await HealthModel.ping();
    if (!dbUp) {
      throw new Error("Database ping returned an unexpected result.");
    }
    return {
      status: "ok",
      database: "up",
      timestamp: new Date().toISOString(),
    };
  }
}
