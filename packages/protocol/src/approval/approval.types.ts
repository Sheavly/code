import type { z } from 'zod';
import type {
  approvalConcernSchema,
  approvalOptionSchema,
  approvalRequestSchema,
  approvalResponseSchema,
  approvalUpdateSchema,
} from './approval.validator.js';

export type ApprovalConcern = z.infer<typeof approvalConcernSchema>;

export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;

export type ApprovalOption = z.infer<typeof approvalOptionSchema>;

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export type ApprovalUpdate = z.infer<typeof approvalUpdateSchema>;
