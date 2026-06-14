package alexa

import "code.pick.haus/grown/grown/internal/music"

// splitmix64 is a tiny, fast, fully deterministic PRNG. Given the same seed it
// always produces the same sequence — which is exactly what the stateless queue
// needs: the shuffle seed is embedded in the AudioPlayer token, so the same
// token always reconstructs the same ordering on every request. We deliberately
// do NOT use math/rand's global source or any time-based seed.
type splitmix64 struct{ state uint64 }

// next advances the generator and returns the next 64-bit value.
func (s *splitmix64) next() uint64 {
	s.state += 0x9e3779b97f4a7c15
	z := s.state
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// shuffle performs an in-place deterministic Fisher-Yates shuffle of tracks
// using a splitmix64 stream seeded by seed. Reproducible: same (tracks order in,
// seed) → same order out.
func shuffle(tracks []music.Track, seed uint64) {
	r := splitmix64{state: seed}
	for i := len(tracks) - 1; i > 0; i-- {
		// Unbiased index in [0, i] via rejection-free modulo is acceptable here
		// (library sizes are tiny vs 2^64); the bias is negligible.
		j := int(r.next() % uint64(i+1))
		tracks[i], tracks[j] = tracks[j], tracks[i]
	}
}

// newSeed derives a non-zero shuffle seed from a source value (e.g. a request
// id or session id) so each "shuffle my music" starts a fresh-but-reproducible
// order. It runs the source bytes through splitmix64's mixing so even similar
// inputs diverge. A zero result is bumped to 1 (0 means "not shuffled").
func newSeed(src string) uint64 {
	var h uint64 = 1469598103934665603 // FNV-1a offset basis
	for i := 0; i < len(src); i++ {
		h ^= uint64(src[i])
		h *= 1099511628211
	}
	s := splitmix64{state: h}
	v := s.next()
	if v == 0 {
		v = 1
	}
	return v
}
