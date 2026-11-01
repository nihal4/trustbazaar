import { Area } from './area.entity';
import { HandoverCodeEntry } from './handover-code-entry.entity';
import { FareRow } from './fare-row.entity';
import { FareTable } from './fare-table.entity';
import { Handover } from './handover.entity';
import { DeliveryIssue } from './delivery-issue.entity';
import { MeetupPoint } from './meetup-point.entity';
import { MeetupProposal } from './meetup-proposal.entity';
import { DeliveryOutboxEvent } from './delivery-outbox-event.entity';
import { CourierProviderEvent } from './courier-provider-event.entity';
import { Quote } from './quote.entity';
import { SavedAddress } from './saved-address.entity';
import { ShipmentStatusChange } from './shipment-status-change.entity';
import { Shipment } from './shipment.entity';

export { Area } from './area.entity';
export { HandoverCodeEntry } from './handover-code-entry.entity';
export { FareRow } from './fare-row.entity';
export { FareTable } from './fare-table.entity';
export { Handover } from './handover.entity';
export { DeliveryIssue } from './delivery-issue.entity';
export { MeetupPoint } from './meetup-point.entity';
export { MeetupProposal } from './meetup-proposal.entity';
export { DeliveryOutboxEvent } from './delivery-outbox-event.entity';
export { CourierProviderEvent } from './courier-provider-event.entity';
export { Quote } from './quote.entity';
export { SavedAddress } from './saved-address.entity';
export { ShipmentStatusChange } from './shipment-status-change.entity';
export { Shipment } from './shipment.entity';

// Every table of the schemas delivery, for TypeOrmModule.forFeature.
export const ENTITIES = [
  Area,
  HandoverCodeEntry,
  FareRow,
  FareTable,
  Handover,
  DeliveryIssue,
  MeetupPoint,
  MeetupProposal,
  DeliveryOutboxEvent,
  CourierProviderEvent,
  Quote,
  SavedAddress,
  ShipmentStatusChange,
  Shipment,
];
