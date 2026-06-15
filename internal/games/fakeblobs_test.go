package games

import (
	"bytes"
	"context"
	"errors"
	"io"
)

var errFakeBlob = errors.New("fake blob store failure")

// fakeBlobs is an in-test BlobStore that records the most recent Put and can be
// configured to fail, so handler tests never need a real Drive blob store.
type fakeBlobs struct {
	putErr    error
	putCalled bool
	putKey    string
	putMIME   string
	putSize   int64
	putBody   []byte

	getErr  error
	getBody []byte
	getMIME string
}

func (f *fakeBlobs) Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error {
	f.putCalled = true
	f.putKey = key
	f.putMIME = mimeType
	f.putSize = size
	if body != nil {
		f.putBody, _ = io.ReadAll(body)
	}
	return f.putErr
}

func (f *fakeBlobs) Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error) {
	if f.getErr != nil {
		return nil, "", 0, f.getErr
	}
	return io.NopCloser(bytes.NewReader(f.getBody)), f.getMIME, int64(len(f.getBody)), nil
}
