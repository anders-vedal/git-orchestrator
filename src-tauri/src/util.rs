//! Normalize a filesystem path for storage / comparison.
//!
//! The rules are **platform-specific** — `normalize_path` is a cfg-split:
//! Windows paths round-trip through one set of rules (drive letters,
//! backslashes, UNC prefix preservation), Unix paths through another
//! (forward slashes, case preserved). The shared contract is that
//! equal-in-the-eyes-of-the-OS paths collapse to the same string so the
//! `UNIQUE` index on `repos.path` / `ignored_paths.path` actually catches
//! case/slash variants.
//!
//! Because the rules differ, a sqlite DB created on one platform is NOT
//! portable to another — move a repo dashboard install between OSes and
//! you'll need to re-add repos.

#[cfg(windows)]
pub fn normalize_path(input: &str) -> String {
    // Windows rules:
    //   - trim surrounding whitespace
    //   - convert forward slashes to backslashes
    //   - collapse runs of backslashes (`\\\\` → `\\`), except at the
    //     very start so UNC prefixes like `\\server\share` survive
    //   - strip trailing separators (but keep `C:\` and `\\` intact)
    //   - uppercase the drive letter so `c:\x` and `C:\x` collide
    let mut s = input.trim().replace('/', "\\");

    let leading_unc = s.starts_with("\\\\");
    let prefix_len = if leading_unc { 2 } else { 0 };
    if s.len() > prefix_len {
        let (prefix, rest) = s.split_at(prefix_len);
        let mut collapsed = String::with_capacity(s.len());
        collapsed.push_str(prefix);
        let mut prev_bs = false;
        for ch in rest.chars() {
            if ch == '\\' {
                if !prev_bs {
                    collapsed.push(ch);
                }
                prev_bs = true;
            } else {
                collapsed.push(ch);
                prev_bs = false;
            }
        }
        s = collapsed;
    }

    if s.len() >= 2 && s.as_bytes()[1] == b':' {
        let mut bytes = s.into_bytes();
        bytes[0] = bytes[0].to_ascii_uppercase();
        s = String::from_utf8(bytes).unwrap_or_default();
    }

    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }

    s
}

#[cfg(not(windows))]
pub fn normalize_path(input: &str) -> String {
    // Unix rules:
    //   - trim surrounding whitespace
    //   - collapse runs of `/` to a single `/` (no UNC concept here —
    //     `//foo` is equivalent to `/foo` on every mainstream kernel)
    //   - strip trailing `/`, but keep root `/` intact
    //   - preserve case (mac/linux filesystems are typically case-
    //     sensitive; case-preserving ones like APFS still treat case as
    //     meaningful for git)
    let trimmed = input.trim();

    let mut collapsed = String::with_capacity(trimmed.len());
    let mut prev_slash = false;
    for ch in trimmed.chars() {
        if ch == '/' {
            if !prev_slash {
                collapsed.push('/');
            }
            prev_slash = true;
        } else {
            collapsed.push(ch);
            prev_slash = false;
        }
    }

    while collapsed.len() > 1 && collapsed.ends_with('/') {
        collapsed.pop();
    }

    collapsed
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn uppercases_drive_letter() {
        assert_eq!(normalize_path("c:\\projects\\foo"), "C:\\projects\\foo");
    }

    #[test]
    fn converts_forward_slashes() {
        assert_eq!(normalize_path("C:/Projects/foo"), "C:\\Projects\\foo");
    }

    #[test]
    fn strips_trailing_separators() {
        assert_eq!(normalize_path("C:\\Projects\\foo\\"), "C:\\Projects\\foo");
        assert_eq!(normalize_path("C:\\Projects\\foo\\\\"), "C:\\Projects\\foo");
    }

    #[test]
    fn keeps_drive_root() {
        assert_eq!(normalize_path("C:\\"), "C:\\");
        assert_eq!(normalize_path("c:/"), "C:\\");
    }

    #[test]
    fn collapses_internal_double_backslashes() {
        assert_eq!(normalize_path("C:\\\\Projects\\\\foo"), "C:\\Projects\\foo");
    }

    #[test]
    fn preserves_unc_prefix() {
        assert_eq!(
            normalize_path("\\\\server\\share\\repo"),
            "\\\\server\\share\\repo"
        );
    }

    #[test]
    fn trims_whitespace() {
        assert_eq!(normalize_path("  C:\\foo  "), "C:\\foo");
    }

    #[test]
    fn idempotent() {
        let once = normalize_path("c:/Projects//foo/");
        let twice = normalize_path(&once);
        assert_eq!(once, twice);
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn collapses_double_slashes() {
        assert_eq!(normalize_path("/home//user///projects"), "/home/user/projects");
    }

    #[test]
    fn strips_trailing_slash() {
        assert_eq!(normalize_path("/home/user/projects/"), "/home/user/projects");
        assert_eq!(normalize_path("/home/user/projects///"), "/home/user/projects");
    }

    #[test]
    fn keeps_root_slash() {
        assert_eq!(normalize_path("/"), "/");
        assert_eq!(normalize_path("//"), "/");
    }

    #[test]
    fn preserves_case() {
        // Critical: case is meaningful on Unix filesystems and must survive.
        assert_eq!(normalize_path("/Users/Alice/Repo"), "/Users/Alice/Repo");
        assert!(normalize_path("/home/User") != normalize_path("/home/user"));
    }

    #[test]
    fn trims_whitespace() {
        assert_eq!(normalize_path("  /home/user/repo  "), "/home/user/repo");
    }

    #[test]
    fn idempotent() {
        let once = normalize_path("/home//user/repo/");
        let twice = normalize_path(&once);
        assert_eq!(once, twice);
    }

    #[test]
    fn handles_relative_paths() {
        // We don't resolve relative paths here — that's canonical()'s job.
        // Just make sure the collapse rules don't explode.
        assert_eq!(normalize_path("./foo/bar"), "./foo/bar");
        assert_eq!(normalize_path("foo//bar/"), "foo/bar");
    }
}
