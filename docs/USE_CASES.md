# Syttr Application Use Cases

## Actors

- Parent
- Nanny/Syttr
- Admin
- Payment Gateway
- Verification Service

## UC-01 Parent Registers an Account

- Primary actor: Parent
- Preconditions: Parent is not logged in.
- Trigger: Parent selects client/parent sign-up.
- Main flow:
  1. Parent opens the welcome screen.
  2. Parent selects the sign-up option for clients.
  3. Parent enters required registration details.
  4. System validates the input.
  5. System creates the account.
  6. System directs the parent to create a client profile.
- Alternate flow:
  1. If required fields are missing or invalid, the system shows validation errors.

## UC-02 Parent Creates Profile and Adds Children

- Primary actor: Parent
- Preconditions: Parent account exists.
- Trigger: Parent continues onboarding after registration.
- Main flow:
  1. Parent enters profile information.
  2. Parent saves the profile.
  3. Parent adds one or more children.
  4. System stores child records.
  5. System moves the user to the next onboarding step.
- Alternate flow:
  1. Parent exits early and completes the profile later from settings.

## UC-03 Parent Posts a Job

- Primary actor: Parent
- Preconditions: Parent is logged in and profile exists.
- Trigger: Parent selects post job.
- Main flow:
  1. Parent enters job details such as date, time, children, and requirements.
  2. System validates the job request.
  3. System stores the job.
  4. System makes the job available to eligible nannies or proceeds with direct hire.
  5. Parent is returned to the home area with the new job visible.
- Alternate flow:
  1. If the parent has payment or subscription requirements not yet satisfied, the system redirects to the appropriate payment/subscription path.

## UC-04 Parent Reviews and Accepts a Job Application

- Primary actor: Parent
- Preconditions: A job exists and at least one nanny has applied.
- Trigger: Parent opens job requests.
- Main flow:
  1. Parent views incoming requests.
  2. Parent opens an application detail.
  3. Parent reviews the nanny profile and request details.
  4. Parent accepts the application.
  5. System updates the booking/job state.
  6. System notifies the nanny.
- Alternate flow:
  1. Parent rejects the application.
  2. System records the rejection and notifies the nanny.

## UC-05 Parent Uses Hire Now

- Primary actor: Parent
- Preconditions: Parent is logged in and a nanny profile is available.
- Trigger: Parent selects an immediate hire flow.
- Main flow:
  1. Parent selects a nanny.
  2. Parent submits a hire-now request.
  3. System creates the booking request.
  4. System sends the request to the selected nanny.
  5. Parent waits for response through notifications or chat.

## UC-06 Parent Manages Payment Methods

- Primary actor: Parent
- Supporting actor: Payment Gateway
- Preconditions: Parent is logged in.
- Trigger: Parent opens payment methods.
- Main flow:
  1. Parent requests to add a payment method.
  2. System creates a setup intent.
  3. Parent completes card entry using the payment SDK.
  4. System stores the payment method reference.
  5. Parent can view the saved method list.
- Alternate flow:
  1. Parent removes an existing payment method.
  2. System deletes the stored payment method reference.

## UC-07 Parent Manages Subscription

- Primary actor: Parent
- Supporting actor: Payment Gateway
- Preconditions: Parent is logged in.
- Trigger: Parent opens subscription management.
- Main flow:
  1. Parent views available plans and current subscription status.
  2. Parent subscribes to a plan.
  3. System processes payment.
  4. System stores subscription purchase details.
  5. Parent can later pause, resume, or cancel the subscription.

## UC-08 Parent Sends and Receives Messages

- Primary actor: Parent
- Secondary actor: Nanny
- Preconditions: Parent has or opens a conversation with a nanny.
- Trigger: Parent opens messages.
- Main flow:
  1. Parent opens the conversation list.
  2. Parent selects a conversation.
  3. Parent sends a message.
  4. System stores the message and updates conversation state.
  5. Nanny receives the new message.

## UC-09 Parent Rates a Nanny

- Primary actor: Parent
- Preconditions: A booking has been completed.
- Trigger: Parent submits a rating from job requests or booking flow.
- Main flow:
  1. Parent opens the completed booking.
  2. Parent submits a rating and optional feedback.
  3. System stores the review data.
  4. System updates nanny rating summaries.

## UC-10 Nanny Registers an Account

- Primary actor: Nanny
- Preconditions: Nanny is not logged in.
- Trigger: Nanny selects sitter sign-up.
- Main flow:
  1. Nanny opens the sign-up screen.
  2. Nanny enters account information.
  3. System validates input.
  4. System creates the account.
  5. System routes the nanny to create a professional profile.

## UC-11 Nanny Creates Profile and Availability

- Primary actor: Nanny
- Preconditions: Nanny account exists.
- Trigger: Nanny continues onboarding.
- Main flow:
  1. Nanny enters profile details, skills, and certifications.
  2. Nanny saves the profile.
  3. Nanny enters availability data.
  4. System stores the availability schedule.
  5. System proceeds to verification.

## UC-12 Nanny Completes Verification and Interview Flow

- Primary actor: Nanny
- Supporting actor: Verification Service
- Preconditions: Nanny profile exists.
- Trigger: Nanny starts verification.
- Main flow:
  1. Nanny opens the verification step.
  2. System initiates verification payment or background-check process.
  3. Nanny schedules an interview.
  4. System stores the interview request.
  5. Nanny moves to pending status until approved.
- Alternate flow:
  1. If profile status is rejected or blacklisted, the system restricts access and shows the pending/rejected state.

## UC-13 Nanny Browses Jobs and Sends a Request

- Primary actor: Nanny
- Preconditions: Nanny is logged in and allowed to access job listings.
- Trigger: Nanny opens jobs.
- Main flow:
  1. Nanny views available jobs.
  2. Nanny opens a job detail.
  3. Nanny submits a request/application.
  4. System stores the application.
  5. Parent receives the request.

## UC-14 Nanny Accepts or Rejects a Hire Request

- Primary actor: Nanny
- Preconditions: A parent has sent a hire request.
- Trigger: Nanny opens hire requests/notifications.
- Main flow:
  1. Nanny views the incoming request.
  2. Nanny accepts or rejects the request.
  3. System updates booking state.
  4. Parent receives the corresponding notification.

## UC-15 Nanny Views Wallet and Withdraws Earnings

- Primary actor: Nanny
- Supporting actor: Payment Gateway
- Preconditions: Completed payable bookings exist and payout setup is valid.
- Trigger: Nanny opens wallet/withdraw.
- Main flow:
  1. Nanny reviews wallet balance and transaction history.
  2. Nanny requests withdrawal.
  3. System validates payout eligibility.
  4. System records the withdrawal action.
  5. Balance and history are updated.

## UC-16 Nanny Manages Favorite Jobs

- Primary actor: Nanny
- Preconditions: Nanny is logged in.
- Trigger: Nanny saves a job as favorite.
- Main flow:
  1. Nanny selects a job.
  2. Nanny adds the job to favorites.
  3. System stores the favorite job link.
  4. Nanny can reopen the list later from settings or favorites.

## UC-17 Admin Reviews Platform Dashboard

- Primary actor: Admin
- Preconditions: Admin is authenticated.
- Trigger: Admin opens the dashboard.
- Main flow:
  1. Admin logs in.
  2. System loads dashboard statistics.
  3. Admin reviews top-level platform metrics.

## UC-18 Admin Reviews Nanny and Parent Profiles

- Primary actor: Admin
- Preconditions: Admin is authenticated.
- Trigger: Admin opens users or nannies.
- Main flow:
  1. Admin views paginated lists.
  2. Admin opens a specific record.
  3. Admin reviews profile details and status.
  4. Admin updates profile status when necessary.

## UC-19 Admin Manages Subscription Plans and Commission Settings

- Primary actor: Admin
- Preconditions: Admin is authenticated.
- Trigger: Admin opens subscriptions or commissions.
- Main flow:
  1. Admin reviews current platform fee and subscription plan data.
  2. Admin creates or updates a plan.
  3. Admin updates commission settings if required.
  4. System stores the updated operational settings.

## UC-20 Admin Reviews Support, Payments, and Audit Logs

- Primary actor: Admin
- Preconditions: Admin is authenticated.
- Trigger: Admin opens support, payments, or audit sections.
- Main flow:
  1. Admin reviews support tickets/messages.
  2. Admin reviews payment activity and subscription earnings.
  3. Admin checks audit logs for traceability.
  4. Admin uses the information for operations and issue resolution.
