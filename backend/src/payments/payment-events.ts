import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/** Process-local bus for payment.detected (settlements listen later). */
@Injectable()
export class PaymentEvents extends EventEmitter {}
