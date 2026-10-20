import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import {
  AuditWriter,
  AuditReader,
  type RequestDecisionEvent,
  type CommerceAuditEvent,
  type AuditEventDto,
  type AuditPageDto,
  type AuditQueryDto,
  type PlatformAuditQueryDto,
  type AuditCategory,
  type AuditOutcome,
} from "./public.js";

const CATEGORY_ACTIONS: Record<AuditCategory, string[]> = {
  EVALUATION: ["EVALUATION_DRAFT_CREATED", "EVALUATION_PROCESSED"],
  CATALOG: [
    "PRODUCT_CREATED",
    "PRODUCT_UPDATED",
    "PRODUCT_ACTIVATED",
    "PRODUCT_DEACTIVATED",
    "INSTITUTION_PRODUCTS_CONFIRMED",
  ],
  TEAM: [
    "ANALYST_INVITATION_CREATED",
    "ANALYST_INVITATION_RESENT",
    "ADMIN_INVITATION_CREATED",
    "ADMIN_INVITATION_RESENT",
    "MEMBERSHIP_ACTIVATED",
    "MEMBERSHIP_SUSPENDED",
    "MEMBERSHIP_REACTIVATED",
    "MEMBERSHIP_REVOKED",
    "INVITATION_CANCELLED",
  ],
  INSTITUTION: [
    "INSTITUTION_INFORMATION_CONFIRMED",
    "BANK_MOCK_ENABLED",
    "BUREAU_MOCK_ENABLED",
    "BUREAU_MOCK_DISABLED",
    "INSTITUTION_PREPARED",
  ],
  OPERATIONS: [
    "INSTITUTION_REQUEST_APPROVED",
    "INSTITUTION_REQUEST_REJECTED",
    "REQUEST_REJECTION_NOTICE_SENT",
    "REQUEST_REJECTION_NOTICE_FAILED",
    "CONTRACTING_ACCESS_ISSUED",
    "CONTRACTING_PLAN_CONFIRMED",
    "CONTRACTING_CONFIRMED",
    "PAYMENT_PAID",
    "PAYMENT_FAILED",
    "TENANT_PROVISIONED",
    "PROVISIONING_RETRY_REQUESTED",
  ],
  PLATFORM: [
    "PLAN_CREATED",
    "PLAN_UPDATED",
    "PLAN_ACTIVATED",
    "PLAN_DEACTIVATED",
    "PROVIDER_GLOBALLY_ENABLED",
    "PROVIDER_GLOBALLY_DISABLED",
    "PROVIDER_DEGRADED",
    "PROVIDER_RECOVERED",
    "OPERATOR_INVITATION_CREATED",
    "OPERATOR_INVITATION_RESENT",
    "OPERATOR_INVITATION_SENT",
    "OPERATOR_INVITATION_FAILED",
    "OPERATOR_INVITATION_REJECTED",
    "OPERATOR_INVITATION_ACCEPTED",
    "OPERATOR_SUSPENDED",
    "OPERATOR_REACTIVATED",
    "OPERATOR_REVOKED",
    "OPERATOR_ACCESS_CHANGE_REJECTED",
  ],
};

const ACTION_METADATA_WHITELIST = new Set([
  "providerCode",
  "previousEnabled",
  "currentEnabled",
  "reason",
  "fromStatus",
  "toStatus",
  "finalStatus",
  "planId",
  "actorKind",
  "from",
  "to",
  "episodeId",
]);

interface ActionInfo {
  label: string;
  category: AuditCategory;
  entityLabel: string;
  defaultOutcome: AuditOutcome;
  summary: (metadata: Record<string, unknown> | null, entityId: string | null) => string;
}

const ACTION_DEFINITIONS: Record<string, ActionInfo> = {
  EVALUATION_DRAFT_CREATED: {
    label: "Borrador de evaluación iniciado",
    category: "EVALUATION",
    entityLabel: "Evaluación crediticia",
    defaultOutcome: "SUCCESS",
    summary: () => "Se inició un nuevo borrador de evaluación crediticia.",
  },
  EVALUATION_PROCESSED: {
    label: "Evaluación crediticia procesada",
    category: "EVALUATION",
    entityLabel: "Evaluación crediticia",
    defaultOutcome: "SUCCESS",
    summary: (meta) => {
      const status = typeof meta?.finalStatus === "string" ? meta.finalStatus : "procesada";
      return `Evaluación crediticia completada con dictamen final: ${status}.`;
    },
  },
  PRODUCT_CREATED: {
    label: "Producto crediticio creado",
    category: "CATALOG",
    entityLabel: "Producto crediticio",
    defaultOutcome: "SUCCESS",
    summary: (_, id) => `Se creó un nuevo producto crediticio en el catálogo${id ? ` (ID: ${id})` : ""}.`,
  },
  PRODUCT_UPDATED: {
    label: "Producto crediticio modificado",
    category: "CATALOG",
    entityLabel: "Producto crediticio",
    defaultOutcome: "SUCCESS",
    summary: (_, id) => `Se modificaron los parámetros y políticas del producto${id ? ` (ID: ${id})` : ""}.`,
  },
  PRODUCT_ACTIVATED: {
    label: "Producto crediticio activado",
    category: "CATALOG",
    entityLabel: "Producto crediticio",
    defaultOutcome: "SUCCESS",
    summary: () => "Se habilitó el producto para participar en evaluaciones crediticias.",
  },
  PRODUCT_DEACTIVATED: {
    label: "Producto crediticio desactivado",
    category: "CATALOG",
    entityLabel: "Producto crediticio",
    defaultOutcome: "SUCCESS",
    summary: () => "Se desactivó el producto del catálogo activo para evaluaciones.",
  },
  ANALYST_INVITATION_CREATED: {
    label: "Invitación de analista enviada",
    category: "TEAM",
    entityLabel: "Invitación de acceso",
    defaultOutcome: "SUCCESS",
    summary: () => "Se generó y envió invitación para un nuevo analista de crédito.",
  },
  ANALYST_INVITATION_RESENT: {
    label: "Invitación de analista reenviada",
    category: "TEAM",
    entityLabel: "Invitación de acceso",
    defaultOutcome: "SUCCESS",
    summary: () => "Se reenvió la invitación de acceso institucional al analista.",
  },
  ADMIN_INVITATION_CREATED: {
    label: "Invitación de administrador enviada",
    category: "TEAM",
    entityLabel: "Invitación de acceso",
    defaultOutcome: "SUCCESS",
    summary: () => "Se emitió invitación para un administrador institucional.",
  },
  ADMIN_INVITATION_RESENT: {
    label: "Invitación de administrador reenviada",
    category: "TEAM",
    entityLabel: "Invitación de acceso",
    defaultOutcome: "SUCCESS",
    summary: () => "Se reenvió la invitación de administración institucional.",
  },
  MEMBERSHIP_ACTIVATED: {
    label: "Membresía institucional activada",
    category: "TEAM",
    entityLabel: "Membresía del equipo",
    defaultOutcome: "SUCCESS",
    summary: () => "Un integrante activó exitosamente su cuenta institucional.",
  },
  MEMBERSHIP_SUSPENDED: {
    label: "Membresía del equipo suspendida",
    category: "TEAM",
    entityLabel: "Membresía del equipo",
    defaultOutcome: "INFO",
    summary: () => "Se suspendió temporalmente el acceso del integrante.",
  },
  MEMBERSHIP_REACTIVATED: {
    label: "Membresía del equipo reactivada",
    category: "TEAM",
    entityLabel: "Membresía del equipo",
    defaultOutcome: "SUCCESS",
    summary: () => "Se reactivaron los accesos del integrante en la institución.",
  },
  MEMBERSHIP_REVOKED: {
    label: "Membresía revocada definitivamente",
    category: "TEAM",
    entityLabel: "Membresía del equipo",
    defaultOutcome: "FAILURE",
    summary: () => "Se revocó de forma permanente el acceso del integrante a la institución.",
  },
  INVITATION_CANCELLED: {
    label: "Invitación de acceso cancelada",
    category: "TEAM",
    entityLabel: "Invitación de acceso",
    defaultOutcome: "INFO",
    summary: () => "Se canceló una invitación de acceso antes de su activación.",
  },
  INSTITUTION_INFORMATION_CONFIRMED: {
    label: "Información institucional confirmada",
    category: "INSTITUTION",
    entityLabel: "Institución",
    defaultOutcome: "SUCCESS",
    summary: () => "Se revisaron y confirmaron los datos legales de la institución.",
  },
  BANK_MOCK_ENABLED: {
    label: "Fuente bancaria habilitada",
    category: "INSTITUTION",
    entityLabel: "Fuente financiera",
    defaultOutcome: "SUCCESS",
    summary: () => "Se habilitó la integración con la fuente bancaria simulada.",
  },
  BUREAU_MOCK_ENABLED: {
    label: "Fuente de buró habilitada",
    category: "INSTITUTION",
    entityLabel: "Fuente financiera",
    defaultOutcome: "SUCCESS",
    summary: () => "Se habilitó la fuente de historial crediticio del buró simulado.",
  },
  BUREAU_MOCK_DISABLED: {
    label: "Fuente de buró deshabilitada",
    category: "INSTITUTION",
    entityLabel: "Fuente financiera",
    defaultOutcome: "INFO",
    summary: () => "Se deshabilitó temporalmente la consulta de buró para la institución.",
  },
  INSTITUTION_PRODUCTS_CONFIRMED: {
    label: "Catálogo inicial confirmado",
    category: "INSTITUTION",
    entityLabel: "Catálogo de productos",
    defaultOutcome: "SUCCESS",
    summary: () => "Se confirmó la oferta de productos crediticios iniciales.",
  },
  INSTITUTION_PREPARED: {
    label: "Preparación institucional completada",
    category: "INSTITUTION",
    entityLabel: "Institución",
    defaultOutcome: "SUCCESS",
    summary: () => "La institución finalizó todos los pasos requeridos para operar.",
  },
  INSTITUTION_REQUEST_APPROVED: {
    label: "Solicitud institucional aprobada",
    category: "OPERATIONS",
    entityLabel: "Solicitud de acceso",
    defaultOutcome: "SUCCESS",
    summary: () => "El operador aprobó la solicitud de acceso para proceder a contratación.",
  },
  INSTITUTION_REQUEST_REJECTED: {
    label: "Solicitud institucional rechazada",
    category: "OPERATIONS",
    entityLabel: "Solicitud de acceso",
    defaultOutcome: "FAILURE",
    summary: () => "El operador rechazó la solicitud institucional tras revisión de requisitos.",
  },
  REQUEST_REJECTION_NOTICE_SENT: {
    label: "Aviso de rechazo enviado",
    category: "OPERATIONS",
    entityLabel: "Notificación",
    defaultOutcome: "SUCCESS",
    summary: () => "Se notificó formalmente por correo el resultado de la solicitud.",
  },
  REQUEST_REJECTION_NOTICE_FAILED: {
    label: "Fallo de notificación de rechazo",
    category: "OPERATIONS",
    entityLabel: "Notificación",
    defaultOutcome: "FAILURE",
    summary: () => "Ocurrió un error al despachar el correo de rechazo de solicitud.",
  },
  CONTRACTING_ACCESS_ISSUED: {
    label: "Enlace de contratación emitido",
    category: "OPERATIONS",
    entityLabel: "Contratación",
    defaultOutcome: "SUCCESS",
    summary: () => "Se emitió el enlace seguro de contratación para el representante legal.",
  },
  CONTRACTING_PLAN_CONFIRMED: {
    label: "Plan comercial confirmado",
    category: "OPERATIONS",
    entityLabel: "Contratación",
    defaultOutcome: "SUCCESS",
    summary: (meta) =>
      `Se confirmó la selección del plan comercial${meta?.planId ? ` (${meta.planId})` : ""}.`,
  },
  CONTRACTING_CONFIRMED: {
    label: "Contratación completada",
    category: "OPERATIONS",
    entityLabel: "Contratación",
    defaultOutcome: "SUCCESS",
    summary: () => "Se perfeccionó el contrato institucional y se programó el aprovisionamiento.",
  },
  PAYMENT_PAID: {
    label: "Pago de suscripción procesado",
    category: "OPERATIONS",
    entityLabel: "Pago de suscripción",
    defaultOutcome: "SUCCESS",
    summary: () => "Se confirmó el pago simulado de la suscripción institucional.",
  },
  PAYMENT_FAILED: {
    label: "Pago de suscripción fallido",
    category: "OPERATIONS",
    entityLabel: "Pago de suscripción",
    defaultOutcome: "FAILURE",
    summary: () => "El intento de procesamiento de pago simulado no pudo completarse.",
  },
  TENANT_PROVISIONED: {
    label: "Institución aprovisionada",
    category: "OPERATIONS",
    entityLabel: "Institución",
    defaultOutcome: "SUCCESS",
    summary: (meta) =>
      `Aprovisionamiento automático exitoso${meta?.planId ? ` con plan ${meta.planId}` : ""}.`,
  },
  PROVISIONING_RETRY_REQUESTED: {
    label: "Reintento de aprovisionamiento solicitado",
    category: "OPERATIONS",
    entityLabel: "Aprovisionamiento",
    defaultOutcome: "INFO",
    summary: () => "El operador autorizó el reintento de aprovisionamiento para la institución.",
  },
  PROVIDER_GLOBALLY_ENABLED: {
    label: "Proveedor habilitado globalmente",
    category: "PLATFORM",
    entityLabel: "Proveedor externo",
    defaultOutcome: "SUCCESS",
    summary: (meta) => `Habilitación global del proveedor ${meta?.providerCode ?? "externo"}.`,
  },
  PROVIDER_GLOBALLY_DISABLED: {
    label: "Corte global de proveedor",
    category: "PLATFORM",
    entityLabel: "Proveedor externo",
    defaultOutcome: "FAILURE",
    summary: (meta) =>
      `Corte de emergencia del proveedor ${meta?.providerCode ?? "externo"}${meta?.reason ? `: ${meta.reason}` : ""}.`,
  },
  PROVIDER_DEGRADED: {
    label: "Proveedor financiero degradado",
    category: "PLATFORM",
    entityLabel: "Proveedor externo",
    defaultOutcome: "FAILURE",
    summary: (meta) => `Se detectó degradación operativa en ${meta?.providerCode ?? "el proveedor externo"}.`,
  },
  PROVIDER_RECOVERED: {
    label: "Proveedor financiero restablecido",
    category: "PLATFORM",
    entityLabel: "Proveedor externo",
    defaultOutcome: "SUCCESS",
    summary: (meta) =>
      `Disponibilidad operativa restablecida en ${meta?.providerCode ?? "el proveedor externo"}.`,
  },
  OPERATOR_INVITATION_CREATED: {
    label: "Invitación de operador creada",
    category: "PLATFORM",
    entityLabel: "Invitación interna",
    defaultOutcome: "INFO",
    summary: () => "Se creó una invitación para un operador interno.",
  },
  OPERATOR_INVITATION_RESENT: {
    label: "Invitación de operador reenviada",
    category: "PLATFORM",
    entityLabel: "Invitación interna",
    defaultOutcome: "INFO",
    summary: () => "Se reenvió una invitación para un operador interno.",
  },
  OPERATOR_INVITATION_SENT: {
    label: "Invitación de operador enviada",
    category: "PLATFORM",
    entityLabel: "Invitación interna",
    defaultOutcome: "SUCCESS",
    summary: () => "Se entregó una invitación para un operador interno.",
  },
  OPERATOR_INVITATION_FAILED: {
    label: "Fallo de entrega de invitación",
    category: "PLATFORM",
    entityLabel: "Invitación interna",
    defaultOutcome: "FAILURE",
    summary: () => "No se pudo entregar una invitación para un operador interno.",
  },
  OPERATOR_INVITATION_REJECTED: {
    label: "Invitación de operador rechazada",
    category: "PLATFORM",
    entityLabel: "Invitación interna",
    defaultOutcome: "FAILURE",
    summary: () => "Se rechazó un intento de activar una invitación interna.",
  },
  OPERATOR_INVITATION_ACCEPTED: {
    label: "Invitación de operador aceptada",
    category: "PLATFORM",
    entityLabel: "Invitación interna",
    defaultOutcome: "SUCCESS",
    summary: () => "Se activó el acceso de un operador interno.",
  },
  OPERATOR_SUSPENDED: {
    label: "Operador suspendido",
    category: "PLATFORM",
    entityLabel: "Operador interno",
    defaultOutcome: "INFO",
    summary: () => "Se suspendió el acceso de un operador interno.",
  },
  OPERATOR_REACTIVATED: {
    label: "Operador reactivado",
    category: "PLATFORM",
    entityLabel: "Operador interno",
    defaultOutcome: "SUCCESS",
    summary: () => "Se reactivó el acceso de un operador interno.",
  },
  OPERATOR_REVOKED: {
    label: "Acceso de operador revocado",
    category: "PLATFORM",
    entityLabel: "Operador interno",
    defaultOutcome: "INFO",
    summary: () => "Se revocó el acceso de un operador interno.",
  },
  OPERATOR_ACCESS_CHANGE_REJECTED: {
    label: "Cambio de acceso rechazado",
    category: "PLATFORM",
    entityLabel: "Operador interno",
    defaultOutcome: "FAILURE",
    summary: () => "Se rechazó un cambio de acceso de un operador interno.",
  },
  PLAN_CREATED: {
    label: "Plan creado",
    category: "PLATFORM",
    entityLabel: "Plan SaaS",
    defaultOutcome: "SUCCESS",
    summary: () => "Se creó un plan del catálogo.",
  },
  PLAN_UPDATED: {
    label: "Plan actualizado",
    category: "PLATFORM",
    entityLabel: "Plan SaaS",
    defaultOutcome: "SUCCESS",
    summary: () => "Se actualizaron las condiciones futuras de un plan.",
  },
  PLAN_ACTIVATED: {
    label: "Plan activado",
    category: "PLATFORM",
    entityLabel: "Plan SaaS",
    defaultOutcome: "SUCCESS",
    summary: () => "Se habilitó un plan para nuevas contrataciones.",
  },
  PLAN_DEACTIVATED: {
    label: "Plan desactivado",
    category: "PLATFORM",
    entityLabel: "Plan SaaS",
    defaultOutcome: "INFO",
    summary: () => "Se retiró un plan de nuevas contrataciones.",
  },
};

@Injectable()
export class AuditService implements AuditWriter, AuditReader {
  constructor(private readonly database: DatabaseUnitOfWork) {}

  async recordPlanCatalogAction(event: {
    actorUserId: string;
    planId: string;
    action: "PLAN_CREATED" | "PLAN_UPDATED" | "PLAN_ACTIVATED" | "PLAN_DEACTIVATED";
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
    effectiveFrom: Date;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "Plan",
        entityId: event.planId,
        metadata: {
          before: event.before,
          after: event.after,
          effectiveFrom: event.effectiveFrom.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  async recordPlatformTeamEvent(event: {
    actorUserId?: string;
    action: string;
    entityType: "PlatformInvitation" | "User";
    entityId: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: event.metadata,
      },
    });
  }
  async countRecentPlatformInvitations(actorUserId: string, since: Date): Promise<number> {
    return this.database.client.auditLog.count({
      where: {
        actorUserId,
        action: { in: ["OPERATOR_INVITATION_CREATED", "OPERATOR_INVITATION_RESENT"] },
        createdAt: { gte: since },
      },
    });
  }
  async recordTeamInvitation(event: {
    tenantId: string;
    actorUserId: string;
    invitationId: string;
    action:
      | "ANALYST_INVITATION_CREATED"
      | "ANALYST_INVITATION_RESENT"
      | "ADMIN_INVITATION_CREATED"
      | "ADMIN_INVITATION_RESENT";
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "MembershipInvitation",
        entityId: event.invitationId,
      },
    });
  }

  async recordTeamAccess(event: {
    tenantId: string;
    actorUserId: string;
    membershipId: string;
    action: "INVITATION_CANCELLED" | "MEMBERSHIP_SUSPENDED" | "MEMBERSHIP_REACTIVATED" | "MEMBERSHIP_REVOKED";
    fromStatus: string;
    toStatus: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "TenantMembership",
        entityId: event.membershipId,
        metadata: { fromStatus: event.fromStatus, toStatus: event.toStatus },
      },
    });
  }

  async recordInstitutionPreparation(event: {
    tenantId: string;
    actorUserId: string;
    action:
      | "INSTITUTION_INFORMATION_CONFIRMED"
      | "BANK_MOCK_ENABLED"
      | "BUREAU_MOCK_ENABLED"
      | "BUREAU_MOCK_DISABLED"
      | "INSTITUTION_PRODUCTS_CONFIRMED"
      | "INSTITUTION_PREPARED";
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "Tenant",
        entityId: event.tenantId,
      },
    });
  }

  async recordProviderAdministration(event: {
    actorUserId: string;
    providerId: string;
    providerCode: string;
    action: "PROVIDER_GLOBALLY_ENABLED" | "PROVIDER_GLOBALLY_DISABLED";
    previousEnabled: boolean;
    currentEnabled: boolean;
    reason?: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: null,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "IntegrationProvider",
        entityId: event.providerId,
        metadata: {
          providerCode: event.providerCode,
          previousEnabled: event.previousEnabled,
          currentEnabled: event.currentEnabled,
          ...(event.reason ? { reason: event.reason } : {}),
        },
      },
    });
  }

  async recordProviderHealthTransition(event: {
    providerId: string;
    providerCode: string;
    action: "PROVIDER_DEGRADED" | "PROVIDER_RECOVERED";
    from: string;
    to: string;
    episodeId: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: null,
        actorUserId: null,
        action: event.action,
        entityType: "IntegrationProvider",
        entityId: event.providerId,
        metadata: {
          providerCode: event.providerCode,
          from: event.from,
          to: event.to,
          episodeId: event.episodeId,
        },
      },
    });
  }

  async findOpenProviderEpisode(providerId: string): Promise<{ episodeId: string; startedAt: Date } | null> {
    const last = await this.database.client.auditLog.findFirst({
      where: {
        entityType: "IntegrationProvider",
        entityId: providerId,
        action: { in: ["PROVIDER_DEGRADED", "PROVIDER_RECOVERED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { action: true, createdAt: true, metadata: true },
    });
    if (!last || last.action !== "PROVIDER_DEGRADED") return null;
    const episodeId = (last.metadata as { episodeId?: unknown } | null)?.episodeId;
    return typeof episodeId === "string" ? { episodeId, startedAt: last.createdAt } : null;
  }

  async recordMembershipActivation(event: {
    userId: string;
    tenantId: string;
    membershipId: string;
    invitationId: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.userId,
        action: "MEMBERSHIP_ACTIVATED",
        entityType: "TenantMembership",
        entityId: event.membershipId,
        metadata: { invitationId: event.invitationId },
      },
    });
  }

  async recordProvisioning(event: {
    tenantId: string;
    contractingId: string;
    membershipId: string;
    planId: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: null,
        action: "TENANT_PROVISIONED",
        entityType: "Tenant",
        entityId: event.tenantId,
        metadata: {
          actorKind: "SYSTEM",
          contractingId: event.contractingId,
          membershipId: event.membershipId,
          planId: event.planId,
        },
      },
    });
  }

  async recordCommerce(event: CommerceAuditEvent): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: { actorKind: event.actorKind },
      },
    });
  }

  async recordRequestDecision(event: RequestDecisionEvent): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: event.actorUserId,
        action:
          event.decision === "APPROVED" ? "INSTITUTION_REQUEST_APPROVED" : "INSTITUTION_REQUEST_REJECTED",
        entityType: "InstitutionRequest",
        entityId: event.requestId,
        metadata: { fromStatus: "PENDING_REVIEW", toStatus: event.decision },
      },
    });
  }

  async recordRequestNotice(event: {
    actorUserId?: string;
    requestId: string;
    action:
      | "REQUEST_REJECTION_NOTICE_SENT"
      | "REQUEST_REJECTION_NOTICE_FAILED"
      | "REQUEST_REJECTION_NOTICE_REQUEUED";
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        entityType: "InstitutionRequest",
        entityId: event.requestId,
        metadata: { actorKind: event.actorUserId ? "OPERATOR" : "SYSTEM" },
      },
    });
  }

  async recordEvaluationDraft(event: {
    tenantId: string;
    actorUserId: string;
    evaluationId: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: "EVALUATION_DRAFT_CREATED",
        entityType: "Evaluation",
        entityId: event.evaluationId,
      },
    });
  }

  async recordEvaluationProcessed(event: {
    tenantId: string;
    actorUserId: string;
    evaluationId: string;
    status: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: "EVALUATION_PROCESSED",
        entityType: "Evaluation",
        entityId: event.evaluationId,
        metadata: { finalStatus: event.status },
      },
    });
  }

  async recordProductCatalogAction(event: {
    tenantId: string;
    actorUserId: string;
    productId: string;
    action: "PRODUCT_CREATED" | "PRODUCT_UPDATED" | "PRODUCT_ACTIVATED" | "PRODUCT_DEACTIVATED";
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "FinancialProduct",
        entityId: event.productId,
        metadata: (event.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  // --------------------------------------------------------------------------
  // READ OPERATIONS (AuditReader) — HU-24
  // --------------------------------------------------------------------------

  async queryInstitutionAudit(
    tenantId: string,
    query: AuditQueryDto,
    tenantSlug?: string,
  ): Promise<AuditPageDto> {
    // Aislamiento multi-tenant inquebrantable (CA-24.03): siempre filtra por tenantId autenticado.
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
    };

    this.applyQueryFilters(where, query);

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));

    // Ejecución paginada con conteo autorizado (CA-24.11)
    const [total, records] = await Promise.all([
      this.database.client.auditLog.count({ where }),
      this.database.client.auditLog.findMany({
        where,
        include: {
          actor: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = records.map((record) => this.mapToAuditEventDto(record, tenantSlug, false));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async queryPlatformAudit(query: PlatformAuditQueryDto): Promise<AuditPageDto> {
    // Visibilidad operativa de plataforma (CA-24.04):
    // Solo entidades operativas de plataforma y nunca expedientes individuales ni PII crediticia.
    const allowedPlatformEntities = [
      "InstitutionRequest",
      "Contracting",
      "Payment",
      "Tenant",
      "IntegrationProvider",
      "TenantProvisioning",
    ];

    const where: Prisma.AuditLogWhereInput = {};

    if (query.tenantId) {
      where.tenantId = query.tenantId;
      where.entityType = { in: allowedPlatformEntities };
    } else {
      where.OR = [{ tenantId: null }, { entityType: { in: allowedPlatformEntities } }];
    }

    this.applyQueryFilters(where, query);

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));

    const [total, records] = await Promise.all([
      this.database.client.auditLog.count({ where }),
      this.database.client.auditLog.findMany({
        where,
        include: {
          actor: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = records.map((record) => this.mapToAuditEventDto(record, undefined, true));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // --------------------------------------------------------------------------
  // HELPERS (Sanitization, Labeling, Resource Links)
  // --------------------------------------------------------------------------

  private applyQueryFilters(where: Prisma.AuditLogWhereInput, query: AuditQueryDto): void {
    if (query.action) {
      where.action = query.action.trim();
    } else if (query.category) {
      const actions = CATEGORY_ACTIONS[query.category];
      if (actions) {
        where.action = { in: actions };
      }
    }

    if (query.from || query.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.from) {
        const fromDate = new Date(query.from);
        if (!isNaN(fromDate.getTime())) {
          fromDate.setUTCHours(0, 0, 0, 0);
          createdAt.gte = fromDate;
        }
      }
      if (query.to) {
        const toDate = new Date(query.to);
        if (!isNaN(toDate.getTime())) {
          toDate.setUTCHours(23, 59, 59, 999);
          createdAt.lte = toDate;
        }
      }
      if (createdAt.gte || createdAt.lte) {
        where.createdAt = createdAt;
      }
    }
  }

  private mapToAuditEventDto(
    record: {
      id: string;
      createdAt: Date;
      action: string;
      entityType: string;
      entityId: string | null;
      metadata: Prisma.JsonValue | null;
      actor: { id: string; fullName: string; email: string } | null;
    },
    tenantSlug?: string,
    isPlatform = false,
  ): AuditEventDto {
    const rawMetadata =
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : null;

    const sanitizedMeta = this.sanitizeMetadata(rawMetadata);
    const def = ACTION_DEFINITIONS[record.action];

    const actionLabel = def?.label ?? record.action.replace(/_/g, " ").toLowerCase();
    const category =
      def?.category ?? (record.entityType === "IntegrationProvider" ? "PLATFORM" : "OPERATIONS");
    const entityLabel = def?.entityLabel ?? record.entityType;

    let outcome: AuditOutcome = def?.defaultOutcome ?? "SUCCESS";
    if (
      record.action.includes("FAILED") ||
      record.action.includes("REJECTED") ||
      record.action.includes("DISABLED") ||
      record.action.includes("REVOKED")
    ) {
      outcome = "FAILURE";
    } else if (rawMetadata?.finalStatus === "FAILED") {
      outcome = "FAILURE";
    }

    const summary = def
      ? def.summary(sanitizedMeta, record.entityId)
      : `Acción ${record.action} sobre ${record.entityType}${record.entityId ? ` (${record.entityId})` : ""}.`;

    // CA-24.10: Enlace a recurso según contexto de permisos
    let resourceLink: string | null = null;
    if (tenantSlug && !isPlatform) {
      if (record.entityType === "Evaluation" && record.entityId) {
        resourceLink = `/${tenantSlug}/evaluaciones/${record.entityId}`;
      } else if (record.entityType === "FinancialProduct") {
        resourceLink = `/${tenantSlug}/productos`;
      } else if (record.entityType === "TenantMembership" || record.entityType === "MembershipInvitation") {
        resourceLink = `/${tenantSlug}/equipo`;
      } else if (record.entityType === "Tenant") {
        resourceLink = `/${tenantSlug}/institucion`;
      }
    } else if (isPlatform) {
      if (record.entityType === "InstitutionRequest" && record.entityId) {
        resourceLink = `/admin/solicitudes/${record.entityId}`;
      } else if (record.entityType === "Contracting") {
        resourceLink = `/admin/contrataciones`;
      } else if (record.entityType === "Tenant" && record.entityId) {
        resourceLink = `/admin/instituciones/${record.entityId}`;
      } else if (record.entityType === "IntegrationProvider") {
        resourceLink = `/admin/proveedores`;
      }
    }

    // Actor legible (CA-24.02)
    const actorType = record.actor ? (isPlatform ? "OPERATOR" : "USER") : "SYSTEM";
    const actorName = record.actor ? record.actor.fullName : "Sistema automático";
    const actorEmail = record.actor ? record.actor.email : null;

    return {
      id: record.id,
      occurredAt: record.createdAt.toISOString(),
      action: record.action,
      actionLabel,
      category,
      outcome,
      entityType: record.entityType,
      entityLabel,
      entityId: record.entityId,
      resourceLink,
      actor: {
        type: actorType,
        name: actorName,
        email: actorEmail,
      },
      summary,
      metadata: sanitizedMeta,
    };
  }

  /**
   * CA-24.08 / CA-24.12: Sanitización de metadatos.
   * Filtra estrictamente contraseñas, tokens completos, secretos, números de cuenta y respuestas de buró.
   */
  private sanitizeMetadata(meta: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!meta) return null;
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(meta)) {
      if (!ACTION_METADATA_WHITELIST.has(key)) {
        continue;
      }
      if (typeof value === "string") {
        // Redacción si accidentalmente pareciera un token largo o secreto
        if (value.length > 256 || /token|secret|bearer/i.test(key)) {
          continue;
        }
      }
      sanitized[key] = value;
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }
}
