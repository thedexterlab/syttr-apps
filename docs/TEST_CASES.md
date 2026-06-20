# Syttr Application Test Cases

## Test Case Format

- ID: Unique test case identifier
- Module: Functional area
- Priority: High, Medium, or Low
- Preconditions: Required setup before execution
- Steps: Actions to perform
- Expected Result: Correct system behavior

## Authentication and Onboarding

### TC-01 Parent Sign-Up

- Module: Authentication
- Priority: High
- Preconditions: Parent email is not already registered.
- Steps:
  1. Open the app.
  2. Choose parent/client sign-up.
  3. Enter valid registration details.
  4. Submit the form.
- Expected Result: Parent account is created and the app moves to client profile creation.

### TC-02 Nanny Sign-Up

- Module: Authentication
- Priority: High
- Preconditions: Nanny email is not already registered.
- Steps:
  1. Open the app.
  2. Choose nanny/sitter sign-up.
  3. Enter valid registration details.
  4. Submit the form.
- Expected Result: Nanny account is created and the app moves to nanny profile creation.

### TC-03 Login With Valid Parent Credentials

- Module: Authentication
- Priority: High
- Preconditions: A valid parent account exists.
- Steps:
  1. Open login.
  2. Enter valid parent credentials.
  3. Submit.
- Expected Result: User is authenticated and routed to the parent home screen.

### TC-04 Login With Valid Nanny Credentials

- Module: Authentication
- Priority: High
- Preconditions: A valid nanny account exists.
- Steps:
  1. Open login.
  2. Enter valid nanny credentials.
  3. Submit.
- Expected Result: User is authenticated and routed to the correct nanny state based on approval status.

### TC-05 Forgot Password

- Module: Authentication
- Priority: Medium
- Preconditions: An existing user account is available.
- Steps:
  1. Open forgot password.
  2. Enter the registered email or required identity data.
  3. Request reset code.
- Expected Result: System accepts the request and sends or records a password reset code flow.

## Parent Features

### TC-06 Create Parent Profile

- Module: Parent Profile
- Priority: High
- Preconditions: Parent account exists and is logged in.
- Steps:
  1. Complete the parent profile form.
  2. Save the profile.
- Expected Result: Profile is stored successfully and the next onboarding step is enabled.

### TC-07 Add Child Record

- Module: Child Management
- Priority: High
- Preconditions: Parent is logged in.
- Steps:
  1. Open child management.
  2. Add child information.
  3. Save.
- Expected Result: Child record appears in the parent account.

### TC-08 Post Job

- Module: Jobs
- Priority: High
- Preconditions: Parent profile exists.
- Steps:
  1. Open post job.
  2. Enter valid job details.
  3. Submit.
- Expected Result: Job is created and becomes available in the parent job list and relevant nanny flows.

### TC-09 View Job Requests

- Module: Jobs
- Priority: High
- Preconditions: A parent job has at least one application.
- Steps:
  1. Open job requests.
  2. Select a request.
- Expected Result: Application details are shown correctly.

### TC-10 Accept Job Application

- Module: Jobs
- Priority: High
- Preconditions: A job request exists.
- Steps:
  1. Open an application.
  2. Tap accept.
- Expected Result: The system updates the request to accepted, creates or updates the booking state, and notifies the nanny.

### TC-11 Reject Job Application

- Module: Jobs
- Priority: High
- Preconditions: A job request exists.
- Steps:
  1. Open an application.
  2. Tap reject.
- Expected Result: The system marks the request rejected and notifies the nanny.

### TC-12 Hire Now Flow

- Module: Jobs
- Priority: Medium
- Preconditions: Parent can access a nanny profile.
- Steps:
  1. Select a nanny.
  2. Start the hire-now flow.
  3. Submit the request.
- Expected Result: A direct hire request is created and visible to the nanny.

### TC-13 Add Payment Method

- Module: Billing
- Priority: High
- Preconditions: Parent is logged in.
- Steps:
  1. Open payment methods.
  2. Add a valid payment method.
  3. Complete payment SDK flow.
- Expected Result: Payment method is saved and listed for future use.

### TC-14 Remove Payment Method

- Module: Billing
- Priority: Medium
- Preconditions: At least one stored payment method exists.
- Steps:
  1. Open payment methods.
  2. Delete a saved method.
- Expected Result: The selected payment method is removed from the list.

### TC-15 Subscribe to a Plan

- Module: Subscription
- Priority: High
- Preconditions: Parent is logged in and has a valid payment method.
- Steps:
  1. Open subscriptions.
  2. Select a plan.
  3. Confirm purchase.
- Expected Result: Subscription becomes active and history/status data is updated.

### TC-16 Pause, Resume, and Cancel Subscription

- Module: Subscription
- Priority: Medium
- Preconditions: Parent has an active or pausable subscription.
- Steps:
  1. Open subscription management.
  2. Pause the subscription.
  3. Resume the subscription.
  4. Cancel the subscription.
- Expected Result: Each action updates subscription status correctly.

### TC-17 Parent Calendar View

- Module: Calendar
- Priority: Medium
- Preconditions: Parent has one or more bookings.
- Steps:
  1. Open the calendar.
  2. Select a booking entry.
- Expected Result: Booking detail opens with the correct job and nanny information.

### TC-18 Parent Rates Nanny

- Module: Ratings
- Priority: Medium
- Preconditions: A completed booking exists.
- Steps:
  1. Open the completed booking or job request detail.
  2. Submit a rating.
- Expected Result: Rating is stored and summary data updates for the nanny.

## Nanny Features

### TC-19 Create Nanny Profile

- Module: Nanny Profile
- Priority: High
- Preconditions: Nanny account exists.
- Steps:
  1. Complete the nanny profile form.
  2. Submit.
- Expected Result: Profile is stored and the user is moved to availability setup.

### TC-20 Save Availability

- Module: Availability
- Priority: High
- Preconditions: Nanny is logged in.
- Steps:
  1. Open availability.
  2. Add or edit available slots.
  3. Save.
- Expected Result: Availability is stored and reflected in future job-matching flows.

### TC-21 Start Verification and Schedule Interview

- Module: Verification
- Priority: High
- Preconditions: Nanny profile and availability are completed.
- Steps:
  1. Open get verified.
  2. Start the process.
  3. Schedule an interview.
- Expected Result: Interview request is stored and the app transitions to pending interview status.

### TC-22 Rejected or Blacklisted Nanny Access Restriction

- Module: Verification
- Priority: High
- Preconditions: Nanny status is rejected or blacklisted in stored or API-driven approval state.
- Steps:
  1. Log in as the affected nanny.
  2. Attempt to access nanny operational screens.
- Expected Result: User is redirected to the restricted/pending flow instead of protected operational screens.

### TC-23 Browse Jobs

- Module: Jobs
- Priority: High
- Preconditions: Approved nanny account exists.
- Steps:
  1. Open nanny jobs.
  2. Select a listed job.
- Expected Result: Job detail opens with the correct information.

### TC-24 Send Job Request

- Module: Jobs
- Priority: High
- Preconditions: Nanny can access a valid job.
- Steps:
  1. Open job detail.
  2. Submit a job request/application.
- Expected Result: Request is stored and becomes visible to the parent.

### TC-25 Accept Hire Request

- Module: Jobs
- Priority: High
- Preconditions: Parent has sent a direct hire request.
- Steps:
  1. Open hire request or related notification.
  2. Accept the request.
- Expected Result: Booking state updates to accepted and the parent is notified.

### TC-26 Reject Hire Request

- Module: Jobs
- Priority: Medium
- Preconditions: Parent has sent a direct hire request.
- Steps:
  1. Open the request.
  2. Reject it.
- Expected Result: Request state is updated and the parent is notified.

### TC-27 View Wallet and Transactions

- Module: Wallet
- Priority: High
- Preconditions: Nanny has transaction data.
- Steps:
  1. Open withdraw or wallet history.
- Expected Result: Balance and transaction list load successfully.

### TC-28 Withdraw Funds

- Module: Wallet
- Priority: High
- Preconditions: Nanny has withdrawable balance and valid payout setup.
- Steps:
  1. Open withdraw.
  2. Submit withdrawal.
- Expected Result: Withdrawal request succeeds and transaction history reflects the update.

### TC-29 Favorite a Job

- Module: Favorites
- Priority: Medium
- Preconditions: A visible job exists.
- Steps:
  1. Open a job.
  2. Add it to favorites.
- Expected Result: Job appears in favorite jobs.

## Shared Communication Features

### TC-30 Parent-Nanny Chat

- Module: Chat
- Priority: High
- Preconditions: A valid parent-nanny conversation exists or can be created.
- Steps:
  1. Open messages.
  2. Select conversation.
  3. Send a message.
- Expected Result: Message is stored, displayed in the thread, and available to the other user.

### TC-31 Notifications List

- Module: Notifications
- Priority: High
- Preconditions: The user has notification data.
- Steps:
  1. Open notifications.
  2. Open a notification detail.
  3. Mark notification as read if supported by the flow.
- Expected Result: Notifications load correctly, details open, and read state updates.

### TC-32 Support Message Submission

- Module: Support
- Priority: Medium
- Preconditions: User is logged in.
- Steps:
  1. Open support/contact flow.
  2. Submit a support message.
- Expected Result: Support message is stored and becomes visible to admin support review.

## Admin Portal

### TC-33 Admin Login

- Module: Admin Authentication
- Priority: High
- Preconditions: Valid admin credentials and API key are configured.
- Steps:
  1. Open admin portal.
  2. Enter valid credentials.
  3. Submit.
- Expected Result: Admin is authenticated and redirected to dashboard.

### TC-34 Dashboard Statistics Load

- Module: Admin Dashboard
- Priority: High
- Preconditions: Admin is logged in.
- Steps:
  1. Open dashboard.
- Expected Result: Dashboard statistics load without authorization or data errors.

### TC-35 Review Nannies and Update Status

- Module: Admin Nanny Management
- Priority: High
- Preconditions: Admin is logged in and nanny records exist.
- Steps:
  1. Open nannies.
  2. Select a profile.
  3. Update profile status.
- Expected Result: The status change is stored and reflected in subsequent nanny access behavior.

### TC-36 Review Parents

- Module: Admin User Management
- Priority: Medium
- Preconditions: Admin is logged in and parent records exist.
- Steps:
  1. Open users.
  2. Open a parent profile.
- Expected Result: Parent data loads correctly.

### TC-37 Review Jobs and Interviews

- Module: Admin Operations
- Priority: Medium
- Preconditions: Admin is logged in and job/interview data exists.
- Steps:
  1. Open jobs.
  2. Open interviews.
- Expected Result: Job and interview records are listed and drill-down views work.

### TC-38 Review Payments, Commissions, and Subscription Plans

- Module: Admin Finance
- Priority: High
- Preconditions: Admin is logged in.
- Steps:
  1. Open payments.
  2. Open commissions.
  3. Open subscriptions.
  4. Update a subscription plan or commission value if authorized.
- Expected Result: Financial data loads correctly and updates persist successfully.

### TC-39 Review Support Messages and Audit Logs

- Module: Admin Support and Compliance
- Priority: Medium
- Preconditions: Admin is logged in.
- Steps:
  1. Open support center.
  2. Open audit logs.
- Expected Result: Support records and audit entries are visible and filterable according to the interface behavior.

## Non-Functional Checks

### TC-40 API Connectivity Configuration

- Module: Configuration
- Priority: High
- Preconditions: Environment is configured for the target backend.
- Steps:
  1. Launch the mobile app.
  2. Perform login and one data-fetch flow.
- Expected Result: The app connects to the configured API base URL and returns live data.

### TC-41 Role Persistence After Restart

- Module: Session Management
- Priority: High
- Preconditions: User is already logged in.
- Steps:
  1. Close the app.
  2. Reopen it.
- Expected Result: Splash logic restores the user to the correct role-specific screen based on saved session state.

### TC-42 Invalid Input Validation

- Module: Validation
- Priority: High
- Preconditions: None.
- Steps:
  1. Attempt sign-up, login, profile, or job submission with missing required data.
- Expected Result: The system blocks submission and shows clear validation feedback.
