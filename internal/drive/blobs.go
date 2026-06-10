package drive

import (
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// BlobsConfig configures the S3 client.
type BlobsConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	Region    string
}

// Blobs wraps an S3 client targeting rustfs (or any S3-compatible store).
type Blobs struct {
	client *s3.Client
	bucket string
}

// NewBlobs constructs an S3 client.
func NewBlobs(ctx context.Context, cfg BlobsConfig) (*Blobs, error) {
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	awsCfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(cfg.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("aws config: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.Endpoint)
		o.UsePathStyle = true
	})
	return &Blobs{client: client, bucket: cfg.Bucket}, nil
}

// Put uploads a blob. `size` is set as Content-Length if positive.
func (b *Blobs) Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error {
	in := &s3.PutObjectInput{
		Bucket:      aws.String(b.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(mimeType),
	}
	if size > 0 {
		in.ContentLength = aws.Int64(size)
	}
	_, err := b.client.PutObject(ctx, in)
	if err != nil {
		return fmt.Errorf("s3.Put %s: %w", key, err)
	}
	return nil
}

// Get streams a blob. Caller must Close the returned ReadCloser.
// Returns (body, contentType, size, error).
func (b *Blobs) Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error) {
	out, err := b.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, "", 0, fmt.Errorf("s3.Get %s: %w", key, err)
	}
	mime := ""
	if out.ContentType != nil {
		mime = *out.ContentType
	}
	size := int64(0)
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	return out.Body, mime, size, nil
}

// Delete removes a blob. Idempotent at the rustfs/S3 level — DeleteObject
// returns success even when the key doesn't exist.
func (b *Blobs) Delete(ctx context.Context, key string) error {
	_, err := b.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("s3.Delete %s: %w", key, err)
	}
	return nil
}
