import { describe, expect, it } from "vitest";
import {
  WHATSAPP_PURPOSES,
  checkCompatibility,
  deriveQrStatus,
  isMetaStatusSendable,
  isTemplateCompatibleWithPurpose,
  purposeByKey,
  assignmentRecordId,
  templateRecordId,
} from "./whatsapp-templates";

describe("compatibility", () => {
  it("passes when template variables are a subset of the purpose values", () => {
    expect(isTemplateCompatibleWithPurpose(["a", "b"], ["a", "b", "c"])).toBe(true);
  });

  it("fails when a required variable is missing and reports which", () => {
    const report = checkCompatibility(["customer_name", "date", "time"], ["customer_name", "date"]);
    expect(report.compatible).toBe(false);
    expect(report.missing).toEqual(["time"]);
    expect(report.satisfied).toEqual(["customer_name", "date"]);
  });

  it("every catalogue purpose's default template is a real key", () => {
    for (const p of WHATSAPP_PURPOSES) {
      expect(typeof p.defaultTemplateName).toBe("string");
      expect(p.defaultTemplateName.length).toBeGreaterThan(0);
    }
  });
});

describe("isMetaStatusSendable", () => {
  it("only APPROVED is sendable", () => {
    expect(isMetaStatusSendable("APPROVED")).toBe(true);
    for (const s of ["PENDING", "REJECTED", "DISABLED", "PAUSED", "UNVERIFIED", "NOT_FOUND"]) {
      expect(isMetaStatusSendable(s)).toBe(false);
    }
  });
});

describe("deriveQrStatus", () => {
  it("is unassigned with no assignment row", () => {
    expect(deriveQrStatus(false, false, "APPROVED")).toBe("unassigned");
  });

  it("is active only when assigned + active + Meta APPROVED", () => {
    expect(deriveQrStatus(true, true, "APPROVED")).toBe("active");
  });

  it("is inactive when the assignment is off even if Meta APPROVED", () => {
    expect(deriveQrStatus(true, false, "APPROVED")).toBe("inactive");
  });

  it("is inactive when active but Meta not APPROVED", () => {
    expect(deriveQrStatus(true, true, "PENDING")).toBe("inactive");
  });
});

describe("id helpers + lookup", () => {
  it("compose stable ids", () => {
    expect(templateRecordId("appointment_confirmed", "en_US")).toBe("appointment_confirmed__en_US");
    expect(assignmentRecordId("appointment_confirmed")).toBe("appointment_confirmed__*__en_US");
    expect(assignmentRecordId("appointment_confirmed", "*", "en_US", "biz_1")).toBe(
      "appointment_confirmed__*__en_US__b_biz_1",
    );
    expect(assignmentRecordId("appointment_confirmed", "growth", "ur")).toBe(
      "appointment_confirmed__growth__ur",
    );
  });

  it("purposeByKey finds and misses cleanly", () => {
    expect(purposeByKey("appointment_confirmed")?.pricingCategory).toBe("transactional");
    expect(purposeByKey("campaign_percent_off")?.pricingCategory).toBe("campaign");
    expect(purposeByKey("nope")).toBeUndefined();
  });

  it("campaign purposes price as campaign, appointment purposes as transactional", () => {
    for (const p of WHATSAPP_PURPOSES) {
      if (p.group === "Campaign") expect(p.pricingCategory).toBe("campaign");
      if (p.group === "Appointment") expect(p.pricingCategory).toBe("transactional");
    }
  });
});
