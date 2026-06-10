package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Client provides S3 storage operations
type Client struct {
	client         *s3.Client
	presignClient  *s3.Client // Uses public endpoint for browser-accessible URLs
	bucket         string
	publicEndpoint string
}

// Config for S3 storage
type Config struct {
	Endpoint       string
	PublicEndpoint string // Public URL for browser-accessible presigned URLs
	Region         string
	Bucket         string
	AccessKey      string
	SecretKey      string
}

// New creates a new S3 storage client
func New(ctx context.Context, cfg Config) (*Client, error) {
	customResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
		if cfg.Endpoint != "" {
			return aws.Endpoint{
				URL:               cfg.Endpoint,
				HostnameImmutable: true,
			}, nil
		}
		return aws.Endpoint{}, &aws.EndpointNotFoundError{}
	})

	awsCfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(cfg.Region),
		config.WithEndpointResolverWithOptions(customResolver),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKey,
			cfg.SecretKey,
			"",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true // Required for MinIO/RustFS compatibility
	})

	// Create presign client with public endpoint if configured
	var presignClient *s3.Client
	publicEndpoint := cfg.PublicEndpoint
	if publicEndpoint != "" {
		publicResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL:               publicEndpoint,
				HostnameImmutable: true,
			}, nil
		})
		publicCfg, err := config.LoadDefaultConfig(ctx,
			config.WithRegion(cfg.Region),
			config.WithEndpointResolverWithOptions(publicResolver),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
				cfg.AccessKey,
				cfg.SecretKey,
				"",
			)),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to load public AWS config: %w", err)
		}
		presignClient = s3.NewFromConfig(publicCfg, func(o *s3.Options) {
			o.UsePathStyle = true
		})
	} else {
		presignClient = client
	}

	return &Client{
		client:         client,
		presignClient:  presignClient,
		bucket:         cfg.Bucket,
		publicEndpoint: publicEndpoint,
	}, nil
}

// GetPresignedURL generates a presigned URL for downloading a file
// Uses the public endpoint if configured for browser accessibility
func (c *Client) GetPresignedURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	presigner := s3.NewPresignClient(c.presignClient)

	request, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expiry
	})
	if err != nil {
		return "", fmt.Errorf("failed to presign URL: %w", err)
	}

	return request.URL, nil
}

// GetPresignedUploadURL generates a presigned URL for uploading a file
// Uses the public endpoint if configured for browser accessibility
func (c *Client) GetPresignedUploadURL(ctx context.Context, key string, expiry time.Duration, contentType string) (string, error) {
	presigner := s3.NewPresignClient(c.presignClient)

	request, err := presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expiry
	})
	if err != nil {
		return "", fmt.Errorf("failed to presign upload URL: %w", err)
	}

	return request.URL, nil
}

// Upload uploads a file to S3
func (c *Client) Upload(ctx context.Context, key string, body io.Reader, contentType string) error {
	_, err := c.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("failed to upload file: %w", err)
	}
	return nil
}

// Download downloads a file from S3
func (c *Client) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	result, err := c.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to download file: %w", err)
	}
	return result.Body, nil
}

// Delete deletes a file from S3
func (c *Client) Delete(ctx context.Context, key string) error {
	_, err := c.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}
	return nil
}
