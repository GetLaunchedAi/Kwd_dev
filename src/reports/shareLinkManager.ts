import * as crypto from 'crypto';
import * as path from 'path';
import { ShareLink, ReportType } from './contracts';
import { readJsonSafe, writeJsonAtomic } from '../storage/jsonStore';

const STATE_FILE = path.join(process.cwd(), 'state', 'share-links.json');

export class ShareLinkManager {
  private static instance: ShareLinkManager;
  private links: ShareLink[] = [];

  private constructor() {
    this.links = readJsonSafe<ShareLink[]>(STATE_FILE, []);
  }

  public static getInstance(): ShareLinkManager {
    if (!ShareLinkManager.instance) {
      ShareLinkManager.instance = new ShareLinkManager();
    }
    return ShareLinkManager.instance;
  }

  /**
   * Generates a new share link for a specific report run.
   */
  public async createShareLink(
    siteSlug: string,
    runId: string,
    reportType: ReportType,
    expiresInDays: number = 7,
    publicView: boolean = true
  ): Promise<ShareLink> {
    const token = crypto.randomBytes(32).toString('hex'); // 64-char hex
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    const newLink: ShareLink = {
      token,
      siteSlug,
      runId,
      reportType,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      publicView
    };

    this.links.push(newLink);
    await this.save();
    return newLink;
  }

  /**
   * Retrieves a share link by token, validating its existence and expiry.
   */
  public async getShareLink(token: string): Promise<ShareLink | null> {
    const link = this.links.find(l => l.token === token);
    if (!link) return null;

    if (new Date(link.expiresAt) < new Date()) {
      await this.deleteShareLink(token);
      return null;
    }

    return link;
  }

  /**
   * Deletes a share link by token.
   */
  public async deleteShareLink(token: string): Promise<void> {
    this.links = this.links.filter(l => l.token !== token);
    await this.save();
  }

  /**
   * Prunes all expired share links.
   */
  public async pruneExpiredLinks(): Promise<number> {
    const now = new Date();
    const initialCount = this.links.length;
    this.links = this.links.filter(l => new Date(l.expiresAt) > now);
    const prunedCount = initialCount - this.links.length;
    
    if (prunedCount > 0) {
      await this.save();
    }
    return prunedCount;
  }

  private async save(): Promise<void> {
    await writeJsonAtomic(STATE_FILE, this.links);
  }
}




