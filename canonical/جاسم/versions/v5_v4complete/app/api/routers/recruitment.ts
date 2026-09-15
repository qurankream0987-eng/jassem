import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { candidates, jobPosts, jobApplications } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";

// CV template generator
function generateCVContent(role: string, name: string, experience?: number, skills?: string[]) {
  const defaultSkills: Record<string, string[]> = {
    developer: ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS"],
    designer: ["Figma", "Adobe XD", "UI/UX", "Prototyping", "User Research"],
    manager: ["Project Management", "Agile", "Scrum", "Leadership", "Strategic Planning"],
    marketing: ["Digital Marketing", "SEO", "Content Strategy", "Analytics", "Social Media"],
    sales: ["B2B Sales", "CRM", "Negotiation", "Lead Generation", "Account Management"],
    default: ["Communication", "Problem Solving", "Teamwork", "Time Management", "Adaptability"],
  };

  const roleKey = Object.keys(defaultSkills).find(k => role.toLowerCase().includes(k)) || "default";
  const selectedSkills = skills || defaultSkills[roleKey];

  return {
    personalInfo: {
      fullName: name,
      title: role,
      summary: `Experienced ${role} with a proven track record of delivering high-quality results. Passionate about innovation and continuous improvement.`,
    },
    skills: selectedSkills,
    experience: Array.from({ length: experience || 3 }, (_, i) => ({
      role: i === 0 ? role : `Senior ${role}`,
      company: `Company ${i + 1}`,
      duration: `${2020 + i} - ${i === 0 ? "Present" : `${2021 + i}`}`,
      highlights: [
        `Led key ${role} initiatives resulting in 25% efficiency improvement`,
        "Collaborated with cross-functional teams to deliver projects on time",
        "Mentored junior team members and facilitated knowledge sharing",
      ],
    })),
    education: [
      {
        degree: "Bachelor's Degree",
        field: "Computer Science",
        institution: "University",
        year: "2019",
      },
    ],
    certifications: selectedSkills.map((skill, i) => ({
      name: `${skill} Professional Certification`,
      year: `${2020 + (i % 4)}`,
    })),
  };
}

// Match score calculator
function calculateJobMatchScore(
  jobSkills: string[],
  candidateSkills: string[],
  jobLevel?: string,
  candidateExperience?: number,
): number {
  const normalizedJobSkills = jobSkills.map(s => s.toLowerCase().trim());
  const normalizedCandidateSkills = candidateSkills.map(s => s.toLowerCase().trim());

  const matchedSkills = normalizedJobSkills.filter(js =>
    normalizedCandidateSkills.some(cs => cs.includes(js) || js.includes(cs)),
  );

  const skillScore = normalizedJobSkills.length > 0
    ? (matchedSkills.length / normalizedJobSkills.length) * 100
    : 50;

  // Experience bonus
  const expBonus = Math.min((candidateExperience || 0) * 2, 20);

  // Level bonus
  let levelBonus = 0;
  if (jobLevel && candidateExperience) {
    const levelMap: Record<string, number> = { entry: 1, mid: 3, senior: 5, lead: 7 };
    const required = levelMap[jobLevel] || 3;
    levelBonus = candidateExperience >= required ? 10 : Math.max(0, (candidateExperience / required) * 10);
  }

  const totalScore = Math.min(Math.round(skillScore + expBonus + levelBonus), 100);
  return totalScore;
}

export const recruitmentRouter = createRouter({
  // AI CV generation
  generateCV: publicQuery
    .input(z.object({
      role: z.string().min(1),
      name: z.string().optional(),
      experience: z.number().min(0).optional(),
      skills: z.array(z.string()).optional(),
    }))
    .query(({ input }) => {
      const cv = generateCVContent(
        input.role,
        input.name || "Candidate",
        input.experience,
        input.skills,
      );
      return {
        ...cv,
        role: input.role,
        name: input.name || "Candidate",
        generatedBy: "JASIM AI",
        halfPriceNote: "الأردن 🇯🇴 مصر 🇪🇬 سوريا 🇸🇾 = نصف السعر!",
      };
    }),

  // Save CV to database
  saveCV: authedQuery
    .input(z.object({
      fullName: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      title: z.string().min(1),
      summary: z.string().optional(),
      skills: z.array(z.string()).min(1),
      experience: z.number().min(0).default(0),
      education: z.string().optional(),
      cvUrl: z.string().optional(),
      aiScore: z.number().min(0).max(100).optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = Number(ctx.user.id);

      // Check if candidate profile already exists
      const existing = await db.select()
        .from(candidates)
        .where(eq(candidates.userId, userId))
        .limit(1);

      if (existing.length > 0) {
        // Update existing
        await db.update(candidates)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(eq(candidates.id, existing[0].id));

        return { success: true, candidateId: existing[0].id, action: "updated" };
      }

      const [candidate] = await db.insert(candidates).values({
        ...input,
        userId,
        isAvailable: true,
      }).$returningId();

      return { success: true, candidateId: candidate.id, action: "created" };
    }),

  // Get user's CV
  getCV: authedQuery
    .query(async ({ ctx }) => {
      const userId = Number(ctx.user.id);
      const [candidate] = await db.select()
        .from(candidates)
        .where(eq(candidates.userId, userId))
        .limit(1);

      if (!candidate) {
        return { success: false, error: "No CV found. Please create one first." };
      }

      return { success: true, cv: candidate };
    }),

  // Update CV sections
  updateCV: authedQuery
    .input(z.object({
      fullName: z.string().optional(),
      title: z.string().optional(),
      summary: z.string().optional(),
      skills: z.array(z.string()).optional(),
      experience: z.number().min(0).optional(),
      education: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      cvUrl: z.string().optional(),
      isAvailable: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = Number(ctx.user.id);

      const existing = await db.select()
        .from(candidates)
        .where(eq(candidates.userId, userId))
        .limit(1);

      if (existing.length === 0) {
        return { success: false, error: "No CV found. Create one first." };
      }

      await db.update(candidates)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(candidates.id, existing[0].id));

      return { success: true, candidateId: existing[0].id, action: "updated" };
    }),

  // Create job post
  createJob: authedQuery
    .input(z.object({
      merchantId: z.number(),
      title: z.string().min(1),
      description: z.string().min(1),
      requirements: z.array(z.string()).min(1),
      skills: z.array(z.string()).min(1),
      salaryMin: z.number().optional(),
      salaryMax: z.number().optional(),
      jobType: z.enum(["full_time", "part_time", "contract", "freelance"]).default("full_time"),
      level: z.enum(["entry", "mid", "senior", "lead"]).default("mid"),
      location: z.string().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      const [job] = await db.insert(jobPosts).values(input).$returningId();
      return { success: true, jobId: job.id };
    }),

  // List jobs with filters
  listJobs: publicQuery
    .input(z.object({
      marketCode: z.string().optional(),
      jobType: z.enum(["full_time", "part_time", "contract", "freelance"]).optional(),
      level: z.enum(["entry", "mid", "senior", "lead"]).optional(),
      active: z.boolean().default(true),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.marketCode) {
        conditions.push(eq(jobPosts.marketCode, input.marketCode));
      }
      if (input?.active !== false) {
        conditions.push(eq(jobPosts.isActive, true));
      }
      if (input?.jobType) {
        conditions.push(eq(jobPosts.jobType, input.jobType));
      }
      if (input?.level) {
        conditions.push(eq(jobPosts.level, input.level));
      }

      const jobs = conditions.length > 0
        ? await db.select().from(jobPosts).where(and(...conditions)).orderBy(desc(jobPosts.createdAt)).limit(50)
        : await db.select().from(jobPosts).orderBy(desc(jobPosts.createdAt)).limit(50);

      // Filter by search term if provided
      let filtered = jobs;
      if (input?.search) {
        const searchLower = input.search.toLowerCase();
        filtered = jobs.filter(j =>
          j.title.toLowerCase().includes(searchLower) ||
          j.description.toLowerCase().includes(searchLower) ||
          (j.skills as string[]).some(s => s.toLowerCase().includes(searchLower)),
        );
      }

      return filtered;
    }),

  // Get job details
  getJob: publicQuery
    .input(z.object({
      id: z.number(),
    }))
    .query(async ({ input }) => {
      const [job] = await db.select()
        .from(jobPosts)
        .where(eq(jobPosts.id, input.id))
        .limit(1);

      if (!job) {
        return { success: false, error: "Job not found" };
      }

      // Get applications for this job
      const applications = await db.select()
        .from(jobApplications)
        .where(eq(jobApplications.jobId, input.id))
        .orderBy(desc(jobApplications.matchScore));

      return {
        success: true,
        job,
        applications: {
          count: applications.length,
          pending: applications.filter(a => a.status === "pending").length,
          reviewing: applications.filter(a => a.status === "reviewing").length,
          accepted: applications.filter(a => a.status === "accepted").length,
          rejected: applications.filter(a => a.status === "rejected").length,
        },
      };
    }),

  // Apply for job
  apply: authedQuery
    .input(z.object({
      jobId: z.number(),
      coverLetter: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = Number(ctx.user.id);

      // Get candidate profile
      const [candidate] = await db.select()
        .from(candidates)
        .where(eq(candidates.userId, userId))
        .limit(1);

      if (!candidate) {
        return { success: false, error: "Please create your CV first before applying." };
      }

      // Get job details
      const [job] = await db.select()
        .from(jobPosts)
        .where(eq(jobPosts.id, input.jobId))
        .limit(1);

      if (!job) {
        return { success: false, error: "Job not found" };
      }

      // Calculate match score
      const matchScore = calculateJobMatchScore(
        (job.skills as string[]) || [],
        (candidate.skills as string[]) || [],
        job.level ?? undefined,
        candidate.experience || 0,
      );

      // Check if already applied
      const existing = await db.select()
        .from(jobApplications)
        .where(
          and(
            eq(jobApplications.jobId, input.jobId),
            eq(jobApplications.candidateId, candidate.id),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return { success: false, error: "You have already applied for this job", applicationId: existing[0].id };
      }

      const [application] = await db.insert(jobApplications).values({
        jobId: input.jobId,
        candidateId: candidate.id,
        matchScore,
        coverLetter: input.coverLetter,
        status: "pending",
      }).$returningId();

      // Update job apply count
      await db.update(jobPosts)
        .set({ applyCount: (job.applyCount || 0) + 1 })
        .where(eq(jobPosts.id, input.jobId));

      return {
        success: true,
        applicationId: application.id,
        matchScore,
        candidateId: candidate.id,
        jobId: input.jobId,
      };
    }),

  // Calculate job-candidate match score
  matchScore: publicQuery
    .input(z.object({
      jobId: z.number(),
      candidateId: z.number(),
    }))
    .query(async ({ input }) => {
      const [job] = await db.select()
        .from(jobPosts)
        .where(eq(jobPosts.id, input.jobId))
        .limit(1);

      const [candidate] = await db.select()
        .from(candidates)
        .where(eq(candidates.id, input.candidateId))
        .limit(1);

      if (!job || !candidate) {
        return { success: false, error: "Job or candidate not found" };
      }

      const score = calculateJobMatchScore(
        (job.skills as string[]) || [],
        (candidate.skills as string[]) || [],
        job.level ?? undefined,
        candidate.experience || 0,
      );

      const jobSkills = (job.skills as string[]) || [];
      const candidateSkills = (candidate.skills as string[]) || [];
      const matchedSkills = jobSkills.filter(js =>
        candidateSkills.some(cs => cs.toLowerCase().includes(js.toLowerCase()) || js.toLowerCase().includes(cs.toLowerCase())),
      );
      const missingSkills = jobSkills.filter(js =>
        !candidateSkills.some(cs => cs.toLowerCase().includes(js.toLowerCase()) || js.toLowerCase().includes(cs.toLowerCase())),
      );

      return {
        success: true,
        score,
        jobId: input.jobId,
        candidateId: input.candidateId,
        breakdown: {
          skillMatch: Math.min(Math.round((matchedSkills.length / (jobSkills.length || 1)) * 100), 100),
          matchedSkills,
          missingSkills,
          experienceYears: candidate.experience || 0,
          levelRequired: job.level,
        },
        recommendation: score >= 80 ? "Strong match" : score >= 60 ? "Good match" : score >= 40 ? "Partial match" : "Weak match",
      };
    }),

  // Get user's applications
  getApplications: authedQuery
    .query(async ({ ctx }) => {
      const userId = Number(ctx.user.id);

      const [candidate] = await db.select()
        .from(candidates)
        .where(eq(candidates.userId, userId))
        .limit(1);

      if (!candidate) {
        return { success: false, error: "No candidate profile found", applications: [] };
      }

      const applications = await db.select()
        .from(jobApplications)
        .where(eq(jobApplications.candidateId, candidate.id))
        .orderBy(desc(jobApplications.createdAt));

      // Enrich with job details
      const enriched = await Promise.all(
        applications.map(async (app) => {
          const [job] = await db.select()
            .from(jobPosts)
            .where(eq(jobPosts.id, app.jobId))
            .limit(1);
          return {
            ...app,
            jobTitle: job?.title || "Unknown",
            jobCompany: job?.merchantId,
            jobLocation: job?.location,
            jobType: job?.jobType,
            salaryRange: job ? `${job.salaryMin || 0} - ${job.salaryMax || 0} ${job.currency}` : "",
          };
        }),
      );

      return {
        success: true,
        candidateId: candidate.id,
        totalApplications: applications.length,
        summary: {
          pending: applications.filter(a => a.status === "pending").length,
          reviewing: applications.filter(a => a.status === "reviewing").length,
          accepted: applications.filter(a => a.status === "accepted").length,
          rejected: applications.filter(a => a.status === "rejected").length,
        },
        applications: enriched,
      };
    }),

  // List candidates
  listCandidates: publicQuery
    .input(z.object({
      marketCode: z.string().optional(),
      title: z.string().optional(),
      available: z.boolean().default(true),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.marketCode) {
        conditions.push(eq(candidates.marketCode, input.marketCode));
      }
      if (input?.available !== false) {
        conditions.push(eq(candidates.isAvailable, true));
      }

      const result = conditions.length > 0
        ? await db.select().from(candidates).where(and(...conditions)).orderBy(desc(candidates.createdAt)).limit(50)
        : await db.select().from(candidates).orderBy(desc(candidates.createdAt)).limit(50);

      return result;
    }),

  // Update application status (for employers)
  updateApplicationStatus: authedQuery
    .input(z.object({
      applicationId: z.number(),
      status: z.enum(["pending", "reviewing", "accepted", "rejected"]),
    }))
    .mutation(async ({ input }) => {
      await db.update(jobApplications)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(jobApplications.id, input.applicationId));
      return { success: true, applicationId: input.applicationId, status: input.status };
    }),
});
