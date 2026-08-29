import { formatDateInTimezone, formatTimeRangeInTimezone } from "@chronus/utils";

export interface BookingEventPayload {
  id: string;
  eventType: "BOOKING_CREATED" | "BOOKING_CANCELLED" | "BOOKING_RESCHEDULED";
  aggregateId: string; // This is bookingId
  payload: {
    id: string;
    organizationId: string;
    status: string;
    member: {
      membershipId: string;
      userId: string;
      name: string;
      email: string;
      timezone: string;
    };
    slot: {
      id: string;
      startTime: string | Date;
      endTime: string | Date;
      mentor: {
        membershipId: string;
        userId: string;
        name: string;
        email: string;
        timezone: string;
      };
    };
    previousSlot?: {
      id: string;
      startTime: string | Date;
      endTime: string | Date;
      mentor: {
        membershipId: string;
        userId: string;
        name: string;
        email: string;
        timezone: string;
      };
    };
  };
  createdAt: string | Date;
}

export interface EmailMessage {
  to: string;
  recipientName: string;
  subject: string;
  body: string;
}

export class EmailService {
  /**
   * Simulates sending an email (can be backed by Resend, SendGrid, SES, or SMTP).
   */
  async sendEmail(message: EmailMessage): Promise<void> {
    // In production, this would invoke nodemailer or transactional email APIs
    console.log(`\n================== 📧 EMAIL NOTIFICATION DISPATCHED ==================`);
    console.log(`To:        "${message.recipientName}" <${message.to}>`);
    console.log(`Subject:   ${message.subject}`);
    console.log(`----------------------------------------------------------------------`);
    console.log(message.body);
    console.log(`======================================================================\n`);
  }

  /**
   * Generates and sends personalized emails for both member and mentor based on self-contained event payload.
   */
  async handleBookingNotification(event: BookingEventPayload): Promise<void> {
    const { eventType, payload: booking } = event;
    const { member, slot, previousSlot } = booking;
    const mentor = slot.mentor;

    const startDate = new Date(slot.startTime);
    const endDate = new Date(slot.endTime);

    const memberTimezone = member.timezone || "UTC";
    const mentorTimezone = mentor.timezone || "UTC";

    // Format times localized to each user's configured timezone
    const memberDateStr = formatDateInTimezone(startDate, memberTimezone);
    const memberTimeStr = formatTimeRangeInTimezone(startDate, endDate, memberTimezone);

    const mentorDateStr = formatDateInTimezone(startDate, mentorTimezone);
    const mentorTimeStr = formatTimeRangeInTimezone(startDate, endDate, mentorTimezone);

    switch (eventType) {
      case "BOOKING_CREATED": {
        // Email to Member
        await this.sendEmail({
          to: member.email,
          recipientName: member.name,
          subject: `Confirmed: Mentoring Session with ${mentor.name}`,
          body: `Hi ${member.name},\n\nYour 1:1 mentoring session with ${mentor.name} is confirmed!\n\n📅 Date: ${memberDateStr}\n⏰ Time: ${memberTimeStr} (${memberTimezone})\n\nLooking forward to a great session!`,
        });

        // Email to Mentor
        await this.sendEmail({
          to: mentor.email,
          recipientName: mentor.name,
          subject: `New Mentoring Booking from ${member.name}`,
          body: `Hi ${mentor.name},\n\n${member.name} has booked a mentoring session with you.\n\n📅 Date: ${mentorDateStr}\n⏰ Time: ${mentorTimeStr} (${mentorTimezone})\nMember Email: ${member.email}`,
        });
        break;
      }

      case "BOOKING_CANCELLED": {
        // Email to Member
        await this.sendEmail({
          to: member.email,
          recipientName: member.name,
          subject: `Cancelled: Mentoring Session with ${mentor.name}`,
          body: `Hi ${member.name},\n\nYour session with ${mentor.name} scheduled for ${memberDateStr} at ${memberTimeStr} (${memberTimezone}) has been cancelled.`,
        });

        // Email to Mentor
        await this.sendEmail({
          to: mentor.email,
          recipientName: mentor.name,
          subject: `Session Cancelled by ${member.name}`,
          body: `Hi ${mentor.name},\n\nThe session scheduled with ${member.name} on ${mentorDateStr} at ${mentorTimeStr} (${mentorTimezone}) has been cancelled. Your slot is now available again.`,
        });
        break;
      }

      case "BOOKING_RESCHEDULED": {
        const isMentorChanged = previousSlot && previousSlot.mentor.membershipId !== mentor.membershipId;

        // 1. Email to Member
        if (isMentorChanged && previousSlot) {
          const oldMentor = previousSlot.mentor;
          await this.sendEmail({
            to: member.email,
            recipientName: member.name,
            subject: `Rescheduled & Reassigned: New Mentoring Session with ${mentor.name}`,
            body: `Hi ${member.name},\n\nYour mentoring session previously booked with ${oldMentor.name} has been rescheduled to ${mentor.name}:\n\n👨‍🏫 Mentor: ${mentor.name}\n📅 Date: ${memberDateStr}\n⏰ Time: ${memberTimeStr} (${memberTimezone})`,
          });
        } else {
          await this.sendEmail({
            to: member.email,
            recipientName: member.name,
            subject: `Rescheduled: Mentoring Session with ${mentor.name}`,
            body: `Hi ${member.name},\n\nYour mentoring session with ${mentor.name} has been rescheduled to:\n\n📅 New Date: ${memberDateStr}\n⏰ New Time: ${memberTimeStr} (${memberTimezone})`,
          });
        }

        // 2. Mentor Notifications
        if (isMentorChanged && previousSlot) {
          // If the mentor changed:
          // a. Send cancellation notice to the OLD mentor
          const oldMentor = previousSlot.mentor;
          const oldMentorTimezone = oldMentor.timezone || "UTC";
          const oldStartDate = new Date(previousSlot.startTime);
          const oldEndDate = new Date(previousSlot.endTime);
          const oldMentorDateStr = formatDateInTimezone(oldStartDate, oldMentorTimezone);
          const oldMentorTimeStr = formatTimeRangeInTimezone(oldStartDate, oldEndDate, oldMentorTimezone);

          await this.sendEmail({
            to: oldMentor.email,
            recipientName: oldMentor.name,
            subject: `Session Reassigned: Booking with ${member.name} Cancelled`,
            body: `Hi ${oldMentor.name},\n\n${member.name} has rescheduled their session to another mentor. Your previously booked slot on ${oldMentorDateStr} at ${oldMentorTimeStr} (${oldMentorTimezone}) is now released and available again.`,
          });

          // b. Send new booking notification to the NEW mentor
          await this.sendEmail({
            to: mentor.email,
            recipientName: mentor.name,
            subject: `New Mentoring Booking from ${member.name}`,
            body: `Hi ${mentor.name},\n\n${member.name} has booked a mentoring session with you (rescheduled from another mentor).\n\n📅 Date: ${mentorDateStr}\n⏰ Time: ${mentorTimeStr} (${mentorTimezone})\nMember Email: ${member.email}`,
          });
        } else {
          // Same mentor rescheduled to a different time slot
          await this.sendEmail({
            to: mentor.email,
            recipientName: mentor.name,
            subject: `Session Rescheduled by ${member.name}`,
            body: `Hi ${mentor.name},\n\n${member.name} has rescheduled their session with you.\n\n📅 New Date: ${mentorDateStr}\n⏰ New Time: ${mentorTimeStr} (${mentorTimezone})`,
          });
        }
        break;
      }

      default:
        console.warn(`[Notification Service] Unhandled eventType: ${(event as any).eventType}`);
    }
  }
}

export const emailService = new EmailService();
