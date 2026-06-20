export type FaqItem = {
  q: string;
  a: string;
};

export const PARENT_FAQS: FaqItem[] = [
  {
    q: "How do I find a suitable babysitter using this app?",
    a: "You can filter a new booking by date and time to see BabySyttr available for your specifications. You can also post a job to the job board; the post goes to all sitters and you can approve or reject requests before a job is scheduled.",
  },
  {
    q: "What kind of background checks do the BabySyttr on your app undergo?",
    a: "All BabySyttr go through a thorough HireSafe background check. We personally vet each sitter to keep safety at the center of the experience.",
  },
  {
    q: "How do nanny payments work on the app?",
    a: "Payments are handled securely through the app. Add your credit card to pay through our system so both parties have a smooth, secure experience.",
  },
  {
    q: "What happens if my regular sitter is unavailable for a scheduled booking?",
    a: "Quickly search and book an alternative babysitter, or post a job on the job board based on your preferences and availability.",
  },
  {
    q: "Can I leave reviews and feedback for the BabySyttr I hire through the app?",
    a: "Yes. After each booking you can leave a review and feedback to help other families make informed decisions when choosing a nanny.",
  },
  {
    q: "How does the nanny matching process work on your app?",
    a: "We use matching algorithms and filters so you can find sitters by experience, availability, and location, or search manually to pick the right fit.",
  },
];

export const NANNY_FAQS: FaqItem[] = [
  {
    q: "How do I set my availability as a BabySyttr on the app?",
    a: "Set your weekly availability from the Home screen under Quick actions. You can also mark specific days on the monthly calendar with different hours without changing your weekly defaults.",
  },
  {
    q: "How and when do I get paid for jobs through the Syttr app?",
    a: "After completing a babysitting job, earnings are processed in the app. From Settings, tap Withdraw earnings to add your bank account or debit card details, then move funds to your preferred payout method.",
  },
  {
    q: "What kind of background checks do BabySyttr on your app undergo?",
    a: "All BabySyttr complete a HireSafe background check. There is a one-time fee, and once results meet requirements you can start accepting jobs.",
  },
  {
    q: "Do I need any specific qualifications or certifications to become a BabySyttr on Syttr?",
    a: "Certifications are not required, but CPR and First Aid training help your profile stand out, especially to premium families. More experience and qualifications can boost visibility and earnings.",
  },
  {
    q: "What is a good hourly rate to set for my jobs?",
    a: "Most BabySyttr on Syttr set rates between $22-27 per hour based on local trends. Families use your rate as a guideline and typically pay at or near what you list.",
  },
  {
    q: "How do I make my profile more attractive in order to get more booking requests?",
    a: "Keep your availability updated to boost bookings, and show flexibility by marking full days or weekends.\n\nOther ways to stand out:\n- Add certifications like CPR or BabySyttr training.\n- Upload a clear, friendly profile photo.\n- Write a detailed bio with ages you've cared for, activities you enjoy, and special skills.\n- Include accurate years of experience.",
  },
];



export default function RouteShim() {
  return null as any;
}

