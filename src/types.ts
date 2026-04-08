export type UserRole = 'admin' | 'technician' | 'supervisor' | 'superuser';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  name: string;
  phone?: string;
}

export type TicketType = 'installation' | 'maintenance';
export type TicketStatus = 'open' | 'in-progress' | 'completed' | 'cancelled';

export interface Ticket {
  id: string;
  type: TicketType;
  status: TicketStatus;
  customerName: string;
  address: string;
  phone: string;
  issue?: string; // for maintenance
  package?: string; // for installation
  technicianId?: string;
  assignedTechnicianIds?: string[];
  locationUrl?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  createdAt: string;
  completedAt?: string;
  report?: string;
  reportAttachmentUrl?: string;
  reportAttachmentName?: string;
  notes?: string;
  technicianNotes?: string;
}

export interface AppSettings {
  fonnteToken: string;
  whatsappGroup?: string;
  templateInstallation?: string;
  templateMaintenance?: string;
  templateClosed?: string;
  mediaRetentionDays?: number;
}
