"""
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.

Verify command - Test protocol setup and filesystem atomicity
"""

import os
import subprocess
import tempfile
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import sys


def verify_command(work_dir: Path, trials: int, concurrency: int):
    """
    Verify protocol setup and filesystem atomicity (MA-T01).
    
    Args:
        work_dir: Root directory of the project
        trials: Number of atomicity test trials
        concurrency: Number of concurrent processes per trial
    """
    coord_dir = work_dir / "coordination"
    
    print("Verifying trinoris-multi-agents protocol setup...\n")
    
    # 1. Check coordination directory exists
    print("1. Checking coordination structure...")
    if not coord_dir.exists():
        print("  ✗ coordination/ directory not found")
        print("  Run: trinoris-agent setup")
        sys.exit(1)
    
    required_dirs = ["locks", "claims", "handoff", "active", "archive", "incidents", "heartbeat"]
    missing = []
    for subdir in required_dirs:
        if not (coord_dir / subdir).exists():
            missing.append(subdir)
    
    if missing:
        print(f"  ✗ Missing directories: {', '.join(missing)}")
        print("  Run: trinoris-agent setup --force")
        sys.exit(1)
    
    print("  ✓ All required directories present")
    
    # 2. Check configuration
    print("\n2. Checking configuration...")
    config_path = work_dir / ".kiro" / "coordination.json"
    if not config_path.exists():
        print("  ✗ Configuration not found: .kiro/coordination.json")
        sys.exit(1)
    print("  ✓ Configuration present")
    
    # 3. Check documentation
    print("\n3. Checking documentation...")
    docs_ok = True
    if not (work_dir / "AGENTS.md").exists():
        print("  ✗ AGENTS.md not found")
        docs_ok = False
    else:
        print("  ✓ AGENTS.md present")
    
    if not (work_dir / ".claude" / "skills" / "trinoris-coordination.md").exists():
        print("  ✗ .claude/skills/trinoris-coordination.md not found")
        docs_ok = False
    else:
        print("  ✓ .claude/skills/trinoris-coordination.md present")
    
    if not docs_ok:
        print("\n  Run: trinoris-agent setup --update-skills")
        sys.exit(1)
    
    # 4. Test mkdir atomicity (MA-T01)
    print(f"\n4. Testing mkdir atomicity (MA-T01)...")
    print(f"   Running {trials} trials with {concurrency} concurrent processes each...")
    
    test_passed = _test_mkdir_atomicity(coord_dir, trials, concurrency)
    
    if test_passed:
        print("\n✓ All verification checks passed!")
        print(f"\nFilesystem: {_get_filesystem_type(coord_dir)}")
        print(f"mkdir atomicity: VERIFIED (N={concurrency}, trials={trials})")
        print("\nYou can now use the coordination protocol safely.")
    else:
        print("\n✗ Atomicity test FAILED")
        print("\nThis filesystem may not be safe for the coordination protocol.")
        print("See specs/02-lock-mechanism.md for details.")
        sys.exit(1)


def _test_mkdir_atomicity(coord_dir: Path, trials: int, concurrency: int) -> bool:
    """
    Test MA-T01: mkdir atomicity under load.
    
    Returns True if exactly one winner in every trial.
    """
    test_dir = coord_dir / ".test-atomicity"
    test_dir.mkdir(exist_ok=True)
    
    failures = 0
    
    for trial in range(trials):
        lock_name = f"trial-{trial}.lock"
        lock_path = test_dir / lock_name
        
        # Ensure clean state
        if lock_path.exists():
            os.rmdir(lock_path)
        
        # Race N processes
        winners = _race_mkdir(lock_path, concurrency)
        
        # Check: exactly 1 winner
        if winners != 1:
            failures += 1
            print(f"  ✗ Trial {trial}: {winners} winners (expected 1)")
        
        # Clean up
        if lock_path.exists():
            os.rmdir(lock_path)
        
        # Progress indicator
        if (trial + 1) % 10 == 0:
            print(f"   {trial + 1}/{trials} trials completed...", end='\r')
    
    print(f"   {trials}/{trials} trials completed      ")
    
    if failures == 0:
        print(f"  ✓ All {trials} trials: exactly 1 winner each")
        return True
    else:
        print(f"  ✗ {failures}/{trials} trials had incorrect winner count")
        return False


def _try_mkdir_worker(args):
    """Worker function for multiprocessing (must be at module level)"""
    lock_path_str, process_id = args
    try:
        os.mkdir(lock_path_str)
        return True
    except FileExistsError:
        return False


def _race_mkdir(lock_path: Path, n: int) -> int:
    """
    Race N processes to mkdir the same directory.
    Returns number of processes that succeeded.
    """
    
    # Use ProcessPoolExecutor for true parallelism
    winners = 0
    lock_path_str = str(lock_path)
    
    with ProcessPoolExecutor(max_workers=n) as executor:
        futures = [executor.submit(_try_mkdir_worker, (lock_path_str, i)) for i in range(n)]
        
        for future in as_completed(futures):
            if future.result():
                winners += 1
    
    return winners


def _get_filesystem_type(path: Path) -> str:
    """Detect filesystem type"""
    try:
        # Try df -T (Linux)
        result = subprocess.run(
            ["df", "-T", str(path)],
            capture_output=True,
            text=True,
            timeout=2
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) >= 2:
                parts = lines[1].split()
                if len(parts) >= 2:
                    return parts[1]
    except:
        pass
    
    try:
        # Try stat -f (macOS/BSD)
        result = subprocess.run(
            ["stat", "-f", "-t", "%T", str(path)],
            capture_output=True,
            text=True,
            timeout=2
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    
    return "unknown"
