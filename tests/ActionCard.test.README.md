# ActionCard Component Tests

This test file (`ActionCard.test.tsx`) verifies the fix for **Bug #4: Data Corruption from Stale Closure**.

## Bug #4 Summary

The ActionCard component had a critical bug where the cleanup effect used stale closure values for `index` and `localAction`. When an action was deleted or reordered, the unmount cleanup could apply updates to the **wrong action**, corrupting user data.

Additionally, the effect recreated on every keystroke (due to `localAction` in the dependency array), causing significant performance overhead.

## The Fix

The fix uses React refs to track the latest values without causing effect recreation:

```typescript
// Refs to store latest values without triggering re-renders
const localActionRef = useRef(localAction);
const indexRef = useRef(index);
const updateActionRef = useRef(updateAction);

// Keep refs in sync
useEffect(() => { localActionRef.current = localAction; }, [localAction]);
useEffect(() => { indexRef.current = index; }, [index]);
useEffect(() => { updateActionRef.current = updateAction; }, [updateAction]);

// Cleanup with empty deps - uses refs for latest values
useEffect(() => {
  return () => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateActionRef.current(indexRef.current, localActionRef.current);
    }
  };
}, []); // Empty deps - cleanup only created once
```

## Setup Instructions

To run these tests, you need to install Jest and React Testing Library:

```bash
npm install --save-dev jest @jest/globals @testing-library/react @testing-library/jest-dom @testing-library/user-event jest-environment-jsdom
```

## Configuration

Create a `jest.config.js` file in the project root:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      }
    }]
  }
};
```

Create a `tests/setup.ts` file:

```typescript
import '@testing-library/jest-dom';
```

Add to `package.json` scripts:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:actioncard": "jest ActionCard.test.tsx"
  }
}
```

## Running the Tests

```bash
# Run all tests
npm test

# Run ActionCard tests only
npm run test:actioncard

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## What the Tests Verify

1. **Flush on unmount with correct index** - Pending updates are saved on unmount
2. **No data corruption when index changes** - Uses latest index, not stale value
3. **Effect only created once** - No performance degradation from recreation
4. **Rapid edits and reordering** - Handles complex scenarios safely
5. **Timer cleanup** - Debounce timer is properly cleared
6. **Latest function references** - Always uses current callback functions
7. **Graceful handling** - No errors when unmounting without pending updates
8. **Prop synchronization** - Local state stays in sync with parent props
9. **Immediate flush on unmount** - Doesn't wait for debounce to complete

## Test Results Interpretation

- ✅ All tests passing = Bug #4 is fixed correctly
- ❌ Test 2 fails = Stale closure problem still exists (data corruption risk)
- ❌ Test 3 fails = Effect recreating on every keystroke (performance issue)
- ❌ Test 4 fails = Cannot handle complex reordering scenarios

## Manual Testing

You can also manually test the fix:

1. Open a dialog with multiple actions
2. Start editing an action (type some text)
3. **Before** the 300ms debounce completes, delete a previous action
4. The action you were editing moves to a different index
5. Switch to a different dialog (unmounts the component)
6. Reload the file and verify your edits were saved to the correct action

**Before the fix:** Edits might be applied to the wrong action or lost
**After the fix:** Edits are always saved to the correct action

## Related Files

- **Fixed file:** `src/renderer/components/ActionCard.tsx`
- **Test file:** `tests/ActionCard.test.tsx`
- **Bug report:** See main bug analysis document
