const { google } = require("googleapis");
const fs = require("fs-extra");
const path = require("path");
const logger = require("../utils/logger");
const database = require("../config/database");

class DriveService {
  constructor() {
    this.drive = null;
    this.initializeAuth();
  }

  /**
   * Initialize Google Drive API authentication
   */
  initializeAuth() {
    try {
      const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        "https://developers.google.com/oauthplayground"
      );

      auth.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      });

      this.drive = google.drive({ version: "v3", auth });
      logger.info("Google Drive API initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Google Drive API", {
        error: error.message,
      });
      throw new Error("Google Drive authentication failed");
    }
  }
  /**
   * Get new videos from Google Drive links that haven't been processed
   */
  async getNewVideos() {
    try {
      const driveLinks = process.env.GOOGLE_DRIVE_LINKS;
      if (!driveLinks) {
        throw new Error("GOOGLE_DRIVE_LINKS not configured");
      }

      // Parse multiple drive links (comma-separated)
      const links = driveLinks
        .split(",")
        .map((link) => link.trim())
        .filter((link) => link);
      logger.info(`Processing ${links.length} Google Drive links`);

      const allVideos = []; // Process each drive link
      for (const link of links) {
        try {
          const linkType = this.determineLinkType(link);

          if (linkType === "folder") {
            const folderId = this.extractFolderIdFromLink(link);
            if (folderId) {
              const folderVideos = await this.getVideosFromFolder(folderId);
              allVideos.push(...folderVideos);
              logger.info(
                `Found ${folderVideos.length} videos from folder: ${link}`
              );
            } else {
              logger.warn(`Could not extract folder ID from link: ${link}`);
            }
          } else if (linkType === "file") {
            const fileId = this.extractFileIdFromLink(link);
            if (fileId) {
              const videoMetadata = await this.getVideoMetadata(fileId);
              if (
                videoMetadata &&
                videoMetadata.mimeType &&
                videoMetadata.mimeType.includes("video/")
              ) {
                allVideos.push(videoMetadata);
                logger.info(`Found video from link: ${videoMetadata.name}`);
              } else {
                logger.warn(`Link does not point to a video file: ${link}`);
              }
            } else {
              logger.warn(`Could not extract file ID from link: ${link}`);
            }
          } else {
            logger.warn(`Unsupported link format: ${link}`);
          }
        } catch (error) {
          logger.error(`Failed to process drive link: ${link}`, {
            error: error.message,
          });
        }
      }

      logger.info(`Found ${allVideos.length} total videos from Drive links`);

      // Filter out already processed videos
      const processedVideoIds = await database.getProcessedVideoIds();
      const newVideos = allVideos.filter(
        (video) => !processedVideoIds.includes(video.id)
      );

      logger.info(`Found ${newVideos.length} new videos to process`);

      // Validate video files
      const validVideos = [];
      for (const video of newVideos) {
        if (await this.isValidVideo(video)) {
          validVideos.push(video);
        } else {
          logger.warn(`Skipping invalid video: ${video.name}`, {
            videoId: video.id,
          });
        }
      }

      return validVideos;
    } catch (error) {
      logger.error("Failed to fetch new videos from Google Drive links", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Extract file ID from Google Drive link
   */
  extractFileIdFromLink(driveLink) {
    try {
      // Handle different Google Drive link formats:
      // https://drive.google.com/file/d/FILE_ID/view
      // https://drive.google.com/open?id=FILE_ID
      // https://drive.google.com/file/d/FILE_ID/edit
      // https://docs.google.com/file/d/FILE_ID/edit

      let fileId = null;

      // Pattern 1: /file/d/FILE_ID/
      const pattern1 = /\/file\/d\/([a-zA-Z0-9-_]+)/;
      const match1 = driveLink.match(pattern1);
      if (match1) {
        fileId = match1[1];
      }

      // Pattern 2: ?id=FILE_ID or &id=FILE_ID
      if (!fileId) {
        const pattern2 = /[?&]id=([a-zA-Z0-9-_]+)/;
        const match2 = driveLink.match(pattern2);
        if (match2) {
          fileId = match2[1];
        }
      }

      if (fileId) {
        logger.info(`Extracted file ID: ${fileId} from link: ${driveLink}`);
      } else {
        logger.warn(`Could not extract file ID from link: ${driveLink}`);
      }

      return fileId;
    } catch (error) {
      logger.error(`Error extracting file ID from link: ${driveLink}`, {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Validate if a video file is processable
   */
  async isValidVideo(video) {
    try {
      // Check file size (max 100MB for Instagram)
      const maxSize = 100 * 1024 * 1024; // 100MB
      if (parseInt(video.size) > maxSize) {
        logger.warn(`Video too large: ${video.name} (${video.size} bytes)`);
        return false;
      }

      // Check supported video formats
      const supportedTypes = [
        "video/mp4",
        "video/mov",
        "video/avi",
        "video/quicktime",
      ];

      if (!supportedTypes.includes(video.mimeType)) {
        logger.warn(
          `Unsupported video format: ${video.name} (${video.mimeType})`
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`Failed to validate video: ${video.name}`, {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Download a video file from Google Drive
   */
  async downloadVideo(video, destinationDir) {
    try {
      const filename = this.sanitizeFilename(video.name);
      const filePath = path.join(destinationDir, filename);

      logger.info(`Downloading video: ${video.name} to ${filePath}`);

      // Get file stream from Google Drive
      const response = await this.drive.files.get(
        {
          fileId: video.id,
          alt: "media",
        },
        { responseType: "stream" }
      );

      // Create write stream
      const writeStream = fs.createWriteStream(filePath);

      // Pipe the response to file
      return new Promise((resolve, reject) => {
        response.data
          .pipe(writeStream)
          .on("error", reject)
          .on("finish", () => {
            logger.info(`Successfully downloaded video: ${video.name}`);
            resolve(filePath);
          });
      });
    } catch (error) {
      logger.error(`Failed to download video: ${video.name}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get video metadata
   */
  async getVideoMetadata(videoId) {
    try {
      const response = await this.drive.files.get({
        fileId: videoId,
        fields:
          "id, name, size, createdTime, modifiedTime, mimeType, description",
      });

      return response.data;
    } catch (error) {
      logger.error(`Failed to get video metadata: ${videoId}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Sanitize filename for safe file system storage
   */
  sanitizeFilename(filename) {
    // Remove or replace invalid characters
    return filename
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .toLowerCase();
  }

  /**
   * Test Google Drive connection
   */
  async testConnection() {
    try {
      const response = await this.drive.files.list({
        pageSize: 1,
        fields: "files(id, name)",
      });

      logger.info("Google Drive connection test successful");
      return true;
    } catch (error) {
      logger.error("Google Drive connection test failed", {
        error: error.message,
      });
      return false;
    }
  }
  /**
   * Test a single Google Drive link
   */
  async testDriveLink(driveLink) {
    try {
      const linkType = this.determineLinkType(driveLink);

      if (linkType === "folder") {
        const folderId = this.extractFolderIdFromLink(driveLink);
        if (!folderId) {
          return {
            success: false,
            error: "Could not extract folder ID from link",
          };
        }

        const videos = await this.getVideosFromFolder(folderId);
        if (!videos || videos.length === 0) {
          return { success: false, error: "No videos found in folder" };
        }

        return {
          success: true,
          linkType: "folder",
          folderId: folderId,
          videosFound: videos.length,
          sampleVideos: videos
            .slice(0, 5)
            .map((v) => ({ name: v.name, size: v.size, mimeType: v.mimeType })),
        };
      } else if (linkType === "file") {
        const fileId = this.extractFileIdFromLink(driveLink);
        if (!fileId) {
          return {
            success: false,
            error: "Could not extract file ID from link",
          };
        }

        const metadata = await this.getVideoMetadata(fileId);
        if (!metadata) {
          return { success: false, error: "Could not access file metadata" };
        }

        const isVideo =
          metadata.mimeType && metadata.mimeType.includes("video/");
        if (!isVideo) {
          return { success: false, error: "File is not a video" };
        }

        const isValid = await this.isValidVideo(metadata);
        if (!isValid) {
          return {
            success: false,
            error: "Video file is not valid for processing",
          };
        }

        return {
          success: true,
          linkType: "file",
          fileId: fileId,
          name: metadata.name,
          size: metadata.size,
          mimeType: metadata.mimeType,
          createdTime: metadata.createdTime,
        };
      } else {
        return { success: false, error: "Unsupported link format" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get video from a single drive link
   */
  async getVideoFromLink(driveLink) {
    try {
      const fileId = this.extractFileIdFromLink(driveLink);
      if (!fileId) {
        throw new Error("Could not extract file ID from link");
      }

      const metadata = await this.getVideoMetadata(fileId);
      if (
        !metadata ||
        !metadata.mimeType ||
        !metadata.mimeType.includes("video/")
      ) {
        throw new Error("Link does not point to a video file");
      }

      const isValid = await this.isValidVideo(metadata);
      if (!isValid) {
        throw new Error("Video file is not valid for processing");
      }

      return metadata;
    } catch (error) {
      logger.error(`Failed to get video from link: ${driveLink}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Determine if a link is a file or folder link
   */
  determineLinkType(driveLink) {
    try {
      // Check if it's a folder link
      if (driveLink.includes("/folders/") || driveLink.includes("folder")) {
        return "folder";
      }

      // Check if it's a file link
      if (
        driveLink.includes("/file/d/") ||
        driveLink.includes("?id=") ||
        driveLink.includes("&id=")
      ) {
        return "file";
      }

      return "unknown";
    } catch (error) {
      logger.error(`Error determining link type: ${driveLink}`, {
        error: error.message,
      });
      return "unknown";
    }
  }

  /**
   * Extract folder ID from Google Drive folder link
   */
  extractFolderIdFromLink(driveLink) {
    try {
      // Handle folder link format:
      // https://drive.google.com/drive/folders/FOLDER_ID
      const pattern = /\/folders\/([a-zA-Z0-9-_]+)/;
      const match = driveLink.match(pattern);

      if (match) {
        const folderId = match[1];
        logger.info(`Extracted folder ID: ${folderId} from link: ${driveLink}`);
        return folderId;
      } else {
        logger.warn(`Could not extract folder ID from link: ${driveLink}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error extracting folder ID from link: ${driveLink}`, {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get all videos from a Google Drive folder
   */
  async getVideosFromFolder(folderId) {
    try {
      logger.info(`Fetching videos from folder: ${folderId}`);

      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false and (mimeType contains 'video/')`,
        fields:
          "files(id, name, size, createdTime, modifiedTime, mimeType, description)",
        orderBy: "createdTime desc",
        pageSize: 50, // Adjust as needed
      });

      const videos = response.data.files || [];
      logger.info(`Found ${videos.length} videos in folder ${folderId}`);

      return videos;
    } catch (error) {
      logger.error(`Failed to get videos from folder: ${folderId}`, {
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = new DriveService();
