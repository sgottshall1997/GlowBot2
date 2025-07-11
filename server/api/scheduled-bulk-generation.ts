import { Request, Response } from 'express';
import { db } from '../db';
import { scheduledBulkJobs, insertScheduledBulkJobSchema } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';
import cron from 'node-cron';

// Store for active cron jobs with enhanced lifecycle management
const activeCronJobs = new Map<number, cron.ScheduledTask>();

// Map to prevent overlapping executions
const executionLocks = new Map<number, boolean>();

// Enhanced cron job lifecycle management
async function stopAndDestroyCronJob(jobId: number): Promise<void> {
  if (activeCronJobs.has(jobId)) {
    console.log(`🛑 STOPPING EXISTING CRON: Found existing cron job for ID ${jobId}, stopping it first`);
    const existingTask = activeCronJobs.get(jobId);
    if (existingTask) {
      try {
        existingTask.stop();
        existingTask.destroy();
        console.log(`✅ EXISTING CRON DESTROYED: Successfully stopped and destroyed cron job for ID ${jobId}`);
      } catch (error) {
        console.error(`⚠️ CRON CLEANUP ERROR: Failed to stop cron job ${jobId}:`, error);
      }
    }
    activeCronJobs.delete(jobId);
  }
  
  // Clear any execution locks
  if (executionLocks.has(jobId)) {
    executionLocks.delete(jobId);
    console.log(`🔓 CLEANUP: Cleared execution lock for job ${jobId}`);
  }
}

// Get all scheduled jobs for a user
export async function getScheduledJobs(req: Request, res: Response) {
  try {
    const userId = 1; // For now, hardcode user ID
    
    const jobs = await db
      .select()
      .from(scheduledBulkJobs)
      .where(eq(scheduledBulkJobs.userId, userId))
      .orderBy(scheduledBulkJobs.createdAt);

    res.json({
      success: true,
      jobs
    });
  } catch (error) {
    console.error('Error fetching scheduled jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch scheduled jobs'
    });
  }
}

// Create a new scheduled job
export async function createScheduledJob(req: Request, res: Response) {
  try {
    const userId = 1; // For now, hardcode user ID
    
    // Validate request body
    const validatedData = insertScheduledBulkJobSchema.parse({
      ...req.body,
      userId
    });

    // Calculate next run time
    const nextRunAt = calculateNextRunTime(validatedData.scheduleTime, validatedData.timezone);

    // Insert the job
    const [newJob] = await db
      .insert(scheduledBulkJobs)
      .values({
        ...validatedData,
        nextRunAt
      })
      .returning();

    // Start the cron job
    await startCronJob(newJob);

    res.json({
      success: true,
      job: newJob
    });
  } catch (error) {
    console.error('Error creating scheduled job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create scheduled job'
    });
  }
}

// 🚨 CRITICAL: Emergency stop all cron jobs with proper cleanup
export async function stopAllCronJobs() {
  console.log('🚨 EMERGENCY: Stopping all active cron jobs...');
  
  let stoppedCount = 0;
  for (const [jobId, task] of activeCronJobs.entries()) {
    try {
      if (task) {
        task.stop();
        task.destroy();
        console.log(`⏹️ Stopped and destroyed cron job ${jobId}`);
        stoppedCount++;
      }
    } catch (error) {
      console.error(`⚠️ Error stopping cron job ${jobId}:`, error);
    }
  }
  
  // Clear all active cron jobs
  activeCronJobs.clear();
  console.log(`✅ Emergency stop completed: ${stoppedCount} cron jobs stopped`);
  
  return stoppedCount;
}

// Emergency stop all cron jobs API endpoint
export async function emergencyStopAllCronJobs(req: Request, res: Response) {
  try {
    console.log(`🚨 EMERGENCY STOP: Stopping all ${activeCronJobs.size} active cron jobs`);
    
    let stoppedCount = 0;
    for (const [jobId, task] of activeCronJobs) {
      try {
        task.stop();
        task.destroy();
        stoppedCount++;
        console.log(`🛑 EMERGENCY STOPPED: Cron job ${jobId}`);
      } catch (error) {
        console.error(`❌ EMERGENCY STOP FAILED: Job ${jobId}:`, error);
      }
    }
    
    activeCronJobs.clear();
    
    console.log(`✅ EMERGENCY STOP COMPLETE: Stopped ${stoppedCount} cron jobs, cleared all active jobs`);
    
    res.json({
      success: true,
      message: `Emergency stop completed: ${stoppedCount} cron jobs stopped`,
      stoppedCount
    });
  } catch (error) {
    console.error('❌ EMERGENCY STOP ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to emergency stop cron jobs'
    });
  }
}

// Get active cron jobs status
export async function getActiveCronJobsStatus(req: Request, res: Response) {
  try {
    const activeJobs = [];
    for (const [jobId, task] of activeCronJobs) {
      activeJobs.push({
        jobId,
        running: task.running,
        destroyed: task.destroyed
      });
    }
    
    res.json({
      success: true,
      totalActiveCronJobs: activeCronJobs.size,
      activeJobs
    });
  } catch (error) {
    console.error('Error getting cron jobs status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cron jobs status'
    });
  }
}

// Update a scheduled job
export async function updateScheduledJob(req: Request, res: Response) {
  try {
    const jobId = parseInt(req.params.id);
    const userId = 1; // For now, hardcode user ID

    // 🛑 CRITICAL FIX: Use enhanced lifecycle management
    console.log(`🔄 UPDATING CRON: Job ${jobId} - stopping existing cron job`);
    await stopAndDestroyCronJob(jobId);

    // Update the job
    const [updatedJob] = await db
      .update(scheduledBulkJobs)
      .set({
        ...req.body,
        nextRunAt: req.body.scheduleTime ? calculateNextRunTime(req.body.scheduleTime, req.body.timezone || 'America/New_York') : undefined,
        updatedAt: new Date()
      })
      .where(and(
        eq(scheduledBulkJobs.id, jobId),
        eq(scheduledBulkJobs.userId, userId)
      ))
      .returning();

    if (!updatedJob) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled job not found'
      });
    }

    // Start the new cron job if the job is active
    if (updatedJob.isActive) {
      console.log(`🆕 CREATING NEW CRON: Starting new cron job for updated job ${jobId}`);
      await startCronJob(updatedJob);
    } else {
      console.log(`⚠️ JOB INACTIVE: Job ${jobId} is not active, skipping cron creation`);
    }

    res.json({
      success: true,
      job: updatedJob
    });
  } catch (error) {
    console.error('Error updating scheduled job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update scheduled job'
    });
  }
}

// Delete a scheduled job
export async function deleteScheduledJob(req: Request, res: Response) {
  try {
    const jobId = parseInt(req.params.id);
    const userId = 1; // For now, hardcode user ID

    // 🛑 CRITICAL FIX: Use enhanced lifecycle management
    console.log(`🗑️ DELETING CRON: Job ${jobId} - stopping and destroying cron job`);
    await stopAndDestroyCronJob(jobId);

    // Delete the job
    const deletedJob = await db
      .delete(scheduledBulkJobs)
      .where(and(
        eq(scheduledBulkJobs.id, jobId),
        eq(scheduledBulkJobs.userId, userId)
      ))
      .returning();

    if (deletedJob.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled job not found'
      });
    }

    res.json({
      success: true,
      message: 'Scheduled job deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting scheduled job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete scheduled job'
    });
  }
}

// Manually trigger a scheduled job
export async function triggerScheduledJob(req: Request, res: Response) {
  try {
    const jobId = parseInt(req.params.id);
    const userId = 1; // For now, hardcode user ID

    // Get the job
    const [job] = await db
      .select()
      .from(scheduledBulkJobs)
      .where(and(
        eq(scheduledBulkJobs.id, jobId),
        eq(scheduledBulkJobs.userId, userId)
      ));

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled job not found'
      });
    }

    // Execute the job
    const result = await executeScheduledJob(job);

    res.json({
      success: true,
      message: 'Job triggered manually',
      result
    });
  } catch (error) {
    console.error('Error triggering scheduled job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger scheduled job'
    });
  }
}

// Helper function to calculate next run time
function calculateNextRunTime(scheduleTime: string, timezone: string): Date {
  const [hours, minutes] = scheduleTime.split(':').map(Number);
  const now = new Date();
  const nextRun = new Date();
  
  nextRun.setHours(hours, minutes, 0, 0);
  
  // If the time has already passed today, schedule for tomorrow
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  
  return nextRun;
}

// Helper function to start a cron job with comprehensive lifecycle management
async function startCronJob(job: any) {
  if (!job.isActive) {
    console.log(`⚠️ CRON START SKIPPED: Job "${job.name}" (ID: ${job.id}) is not active`);
    return;
  }

  // 🛑 CRITICAL FIX: Always stop and destroy existing cron job before creating new one
  await stopAndDestroyCronJob(job.id);
  
  // 🕒 RACE CONDITION PREVENTION: Add small delay to ensure cleanup is complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // 🔒 ADDITIONAL SAFEGUARD: Verify no existing cron job before proceeding
  if (activeCronJobs.has(job.id)) {
    console.log(`⚠️ RACE CONDITION DETECTED: Job ${job.id} still exists after cleanup, forcing removal`);
    activeCronJobs.delete(job.id);
    if (executionLocks.has(job.id)) {
      executionLocks.delete(job.id);
    }
  }

  // 🚫 CRITICAL SAFEGUARD: Check if scheduled generation is allowed
  const { validateGenerationRequest, detectGenerationContext } = await import('../config/generation-safeguards');
  const mockRequest = {
    headers: {
      'user-agent': 'scheduled-job-runner',
      'x-generation-source': 'scheduled_job'
    }
  };
  
  const context = detectGenerationContext(mockRequest);
  const validation = validateGenerationRequest(context);
  
  if (!validation.allowed) {
    console.log(`🚫 SCHEDULED JOB STARTUP BLOCKED: ${validation.reason}`);
    console.log(`   Job "${job.name}" will not be started due to safeguard restrictions`);
    return;
  }

  // Convert schedule time to cron format (minute hour * * *)
  const [hours, minutes] = job.scheduleTime.split(':').map(Number);
  const cronExpression = `${minutes} ${hours} * * *`;

  console.log(`📅 CREATING NEW CRON: Job "${job.name}" (ID: ${job.id}) with cron: ${cronExpression}`);

  const task = cron.schedule(cronExpression, async () => {
    console.log(`🔄 CRON EXECUTION: Starting scheduled job "${job.name}" (ID: ${job.id})`);
    console.log(`🔒 EXECUTION LOCK: Checking for overlapping executions for job ${job.id}`);
    
    // Prevent overlapping executions
    if (executionLocks.has(job.id)) {
      console.log(`⚠️ EXECUTION BLOCKED: Job ${job.id} is already running, skipping this execution`);
      return;
    }
    
    executionLocks.set(job.id, true);
    
    try {
      await executeScheduledJob(job);
      console.log(`✅ CRON COMPLETED: Successfully executed job "${job.name}" (ID: ${job.id})`);
    } catch (error) {
      console.error(`❌ CRON ERROR: Failed executing job "${job.name}" (ID: ${job.id}):`, error);
    } finally {
      executionLocks.delete(job.id);
      console.log(`🔓 EXECUTION UNLOCKED: Released lock for job ${job.id}`);
    }
  }, {
    scheduled: true,
    timezone: job.timezone
  });

  activeCronJobs.set(job.id, task);
  console.log(`✅ CRON STARTED: New cron job created and stored for ID ${job.id}. Total active cron jobs: ${activeCronJobs.size}`);
  console.log(`📊 CRON LIFECYCLE: Job ${job.id} task registered with proper stop/destroy tracking`);
  
  // Add comprehensive logging for cron job lifecycle
  console.log(`🔍 CRON VERIFICATION: Job ${job.id} scheduled for ${cronExpression} (${job.scheduleTime} in ${job.timezone})`);
  console.log(`🎯 CRON DETAILS: Running=${task.running}, Destroyed=${task.destroyed}`);
}

// Helper function to execute a scheduled job
async function executeScheduledJob(job: any) {
  try {
    console.log(`🚀 Attempting scheduled bulk generation: ${job.name}`);
    
    // 🚫 CRITICAL SAFEGUARD: Apply generation safeguards to scheduled jobs
    const { validateGenerationRequest, detectGenerationContext } = await import('../config/generation-safeguards');
    const mockRequest = {
      headers: {
        'user-agent': 'scheduled-job-runner',
        'x-generation-source': 'scheduled_job'
      }
    };
    
    const context = detectGenerationContext(mockRequest);
    const validation = validateGenerationRequest(context);
    
    if (!validation.allowed) {
      console.log(`🚫 SCHEDULED JOB BLOCKED: ${validation.reason}`);
      
      // Update job with blocked status
      await db
        .update(scheduledBulkJobs)
        .set({
          lastRunAt: new Date(),
          lastError: `Blocked by safeguards: ${validation.reason}`,
          consecutiveFailures: job.consecutiveFailures + 1
        })
        .where(eq(scheduledBulkJobs.id, job.id));
      
      throw new Error(`Scheduled job blocked by safeguards: ${validation.reason}`);
    }
    
    console.log(`🟢 SAFEGUARD: Scheduled job "${job.name}" validated - proceeding with generation`);
    
    // Update last run time and increment total runs
    await db
      .update(scheduledBulkJobs)
      .set({
        lastRunAt: new Date(),
        totalRuns: job.totalRuns + 1,
        nextRunAt: calculateNextRunTime(job.scheduleTime, job.timezone),
        consecutiveFailures: 0, // Reset on successful start
        lastError: null
      })
      .where(eq(scheduledBulkJobs.id, job.id));

    // Prepare the request payload for the unified generator
    const payload = {
      mode: 'automated',
      selectedNiches: job.selectedNiches,
      tones: job.tones,
      templates: job.templates,
      platforms: job.platforms,
      useExistingProducts: job.useExistingProducts,
      generateAffiliateLinks: job.generateAffiliateLinks,
      useSpartanFormat: job.useSpartanFormat,
      useSmartStyle: job.useSmartStyle,
      aiModel: job.aiModel || 'claude', // CRITICAL FIX: Pass AI model from scheduled job
      affiliateId: job.affiliateId,
      webhookUrl: job.webhookUrl,
      sendToMakeWebhook: job.sendToMakeWebhook,
      userId: job.userId,
      scheduledJobId: job.id, // Track that this was from a scheduled job
      scheduledJobName: job.name
    };

    console.log(`🚨 CRITICAL AI MODEL DEBUG: job.aiModel="${job.aiModel}", payload.aiModel="${payload.aiModel}"`);
    console.log(`🔥 FINAL PAYLOAD AI MODEL: "${payload.aiModel}" - THIS MUST BE USED IN GENERATION`);
    console.log(`🎯 NICHE LIST: [${payload.selectedNiches.join(', ')}] - Expecting exactly ${payload.selectedNiches.length} outputs`);
    console.log(`🎭 GENERATION PARAMS: Tones: [${payload.tones.join(', ')}], Templates: [${payload.templates.join(', ')}]`);

    // Call the unified content generator
    const response = await fetch('http://localhost:5000/api/generate-unified', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-generation-source': 'scheduled_job'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Content generation failed');
    }

    console.log(`✅ Scheduled job "${job.name}" completed successfully`);
    return result;

  } catch (error) {
    console.error(`❌ Error executing scheduled job ${job.name}:`, error);
    
    // Update failure count and error
    await db
      .update(scheduledBulkJobs)
      .set({
        consecutiveFailures: job.consecutiveFailures + 1,
        lastError: error instanceof Error ? error.message : 'Unknown error'
      })
      .where(eq(scheduledBulkJobs.id, job.id));

    throw error;
  }
}

// Initialize all active scheduled jobs on server start
export async function initializeScheduledJobs() {
  try {
    console.log('📅 Initializing scheduled bulk generation jobs...');
    
    // 🚫 CRITICAL SAFEGUARD: Check if scheduled generation is allowed
    const { validateGenerationRequest, detectGenerationContext } = await import('../config/generation-safeguards');
    const mockRequest = {
      headers: {
        'user-agent': 'scheduled-job-init',
        'x-generation-source': 'scheduled_job'
      }
    };
    
    const context = detectGenerationContext(mockRequest);
    const validation = validateGenerationRequest(context);
    
    if (!validation.allowed) {
      console.log(`🚫 SCHEDULED JOB INITIALIZATION BLOCKED: ${validation.reason}`);
      console.log('   No scheduled jobs will be started due to safeguard restrictions');
      return;
    }
    
    // 🛑 CRITICAL FIX: Clear any existing cron jobs to prevent duplicates
    if (activeCronJobs.size > 0) {
      console.log(`🧹 STARTUP CLEANUP: Found ${activeCronJobs.size} existing cron jobs, clearing them first`);
      for (const [jobId, task] of activeCronJobs) {
        try {
          task.stop();
          task.destroy();
          console.log(`🗑️ STARTUP CLEANUP: Stopped existing cron job ${jobId}`);
        } catch (error) {
          console.error(`❌ STARTUP CLEANUP ERROR: Job ${jobId}:`, error);
        }
      }
      activeCronJobs.clear();
      console.log('✅ STARTUP CLEANUP: All existing cron jobs cleared');
    }
    
    const activeJobs = await db
      .select()
      .from(scheduledBulkJobs)
      .where(eq(scheduledBulkJobs.isActive, true));

    for (const job of activeJobs) {
      await startCronJob(job);
    }

    console.log(`📅 INITIALIZED: ${activeJobs.length} scheduled jobs, total active cron jobs: ${activeCronJobs.size}`);
  } catch (error) {
    console.error('Error initializing scheduled jobs:', error);
  }
}