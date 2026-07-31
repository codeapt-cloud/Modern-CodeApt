/**
 * Idempotent careers seed — a few postings covering the states tests exercise.
 * Re-runnable: postings upsert by (company, title).
 *
 *   pnpm --filter @codeapt/api seed:careers
 *
 * Postings:
 *   Full-time SDE (open, deadline +30d)
 *   Frontend Internship (open, no deadline)
 *   Data Analyst (CLOSED — deadline in the past, for negative tests)
 */
import { PostingType } from "@codeapt/shared";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { JobModel } from "../models/careers.model.js";

const DAY = 24 * 60 * 60 * 1000;

interface PostingSeed {
  company: string;
  title: string;
  companyLogo?: string;
  location: string;
  employmentType: PostingType;
  compensation: string;
  description: string;
  requirements: string;
  deadline: Date | null;
  isActive: boolean;
}

async function seedCareers(): Promise<void> {
  await connectDatabase();
  try {
    const now = Date.now();
    const postings: PostingSeed[] = [
      {
        company: "Acme Corp",
        title: "Software Engineer",
        location: "Bengaluru, IN",
        employmentType: PostingType.FULL_TIME,
        compensation: "₹12–16 LPA",
        description:
          "Build and scale backend services in a fast-moving product team.",
        requirements:
          "Strong DSA, one of Java/Go/Node, and solid CS fundamentals.",
        deadline: new Date(now + 30 * DAY),
        isActive: true,
      },
      {
        company: "Pixeled",
        title: "Frontend Intern",
        location: "Remote",
        employmentType: PostingType.INTERNSHIP,
        compensation: "₹25,000/month",
        description:
          "A 6-month internship building delightful React interfaces.",
        requirements: "React + TypeScript basics; an eye for detail.",
        deadline: null, // rolling — no deadline
        isActive: true,
      },
      {
        company: "DataWorks",
        title: "Data Analyst",
        location: "Hyderabad, IN",
        employmentType: PostingType.FULL_TIME,
        compensation: "₹8–10 LPA",
        description: "Turn messy data into decisions for the growth team.",
        requirements: "SQL, Python, and a statistics foundation.",
        deadline: new Date(now - 5 * DAY), // already closed
        isActive: true,
      },
    ];

    for (const p of postings) {
      await JobModel.findOneAndUpdate(
        { company: p.company, title: p.title },
        {
          $set: {
            companyLogo: p.companyLogo ?? "",
            location: p.location,
            employmentType: p.employmentType,
            compensation: p.compensation,
            description: p.description,
            requirements: p.requirements,
            deadline: p.deadline,
            isActive: p.isActive,
          },
          $setOnInsert: { postedAt: new Date() },
        },
        { upsert: true, new: true },
      );
    }

    logger.info(
      `Careers seed complete: ${postings.length} postings ` +
        `(${postings.map((p) => `${p.company}/${p.title}`).join(", ")})`,
    );
  } finally {
    await disconnectDatabase();
  }
}

seedCareers()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:careers failed");
    process.exit(1);
  });
