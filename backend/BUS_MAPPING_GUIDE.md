# Bus Mapping & Passenger Assignment Guide

## Overview
These scripts help you diagnose and fix bus assignment issues for students and employees, including those who are completely unassigned to any bus.

---

## Three Available Scripts

### 1. **findUnassignedPassengers.js** (Quick Overview)
**Purpose:** Find all passengers with NO bus assignment

**When to use:** First, to see exactly who's unassigned and which routes they're on

**Run:**
```powershell
cd backend
node scripts/findUnassignedPassengers.js
```

**Output shows:**
- List of all unassigned students (with admission number, route, stage)
- List of all unassigned employees (with emp_no, route, stage)
- Which buses are available on each route
- Total count of unassigned passengers

---

### 2. **checkBusDiscrepancies.js** (Comprehensive Diagnostic)
**Purpose:** Find ALL bus assignment issues including:
- ✅ Passengers with NO bus assignment
- ✅ Passengers assigned to non-existent buses
- ✅ Passengers whose assigned bus isn't mapped to their route
- ✅ Passengers whose assigned bus is unassigned to any route

**When to use:** Before running cleanup, to see the full scope of issues

**Run:**
```powershell
cd backend
node scripts/checkBusDiscrepancies.js
```

**Output shows:**
- Detailed list of every issue with affected passenger
- Issue type and reason
- Bus and route mismatch information

---

### 3. **cleanupBusDiscrepancies.js** (Auto-Fix)
**Purpose:** Automatically correct all bus assignment issues by:
- ✅ Assigning unassigned passengers to an available bus on their route
- ✅ Fixing passengers with wrong bus assignments
- ✅ If no bus is available on a route, setting bus_id to null

**When to use:** After reviewing diagnostic reports, to fix the issues

**Run:**
```powershell
cd backend
node scripts/cleanupBusDiscrepancies.js
```

**What it does:**
- Updates each passenger's `bus_id` to match an available bus on their route
- Prints a log for each update: `[UPDATED] Student: John Doe (ADM123) on Route "R1": Bus "UNASSIGNED" -> "B5"`
- Shows completion summary

---

## Complete Workflow

### Step 1: See Who's Unassigned (Quick Check)
```powershell
node scripts/findUnassignedPassengers.js
```
- Choose option 3 (Both Students and Employees)
- Review the list

### Step 2: Run Full Diagnostic
```powershell
node scripts/checkBusDiscrepancies.js
```
- Choose option 3 (Both Students and Employees)
- Review all discrepancies and understand the scope

### Step 3: Auto-Fix All Issues
```powershell
node scripts/cleanupBusDiscrepancies.js
```
- Choose option 3 (Both Students and Employees)
- Review the update log
- All passengers are now reassigned

### Step 4: Verify (Optional)
```powershell
node scripts/checkBusDiscrepancies.js
```
- Should show: "✅ No discrepancies found!"

---

## What Gets Updated

When `cleanupBusDiscrepancies.js` runs, it updates the `bus_id` field in two collections:
- **TransportRequest** (Students)
- **EmployeeTransportRequest** (Employees)

The new bus_id is determined by:
1. Finding all buses currently assigned to the passenger's route
2. Assigning the first available bus (arbitrary but consistent)
3. If no buses exist on the route, setting bus_id to null (unassigned)

---

## Examples

### Scenario 1: Unassigned Passenger
**Before:**
```
Student: Rajesh Kumar (ADM001)
Route: "Route-A" (R1)
Bus ID: null
```
**After (if buses exist on Route-A):**
```
Student: Rajesh Kumar (ADM001)
Route: "Route-A" (R1)
Bus ID: "BUS-001"
```

### Scenario 2: Wrong Bus Assignment
**Before:**
```
Student: Priya Singh (ADM002)
Route: "Route-B" (R2)
Bus ID: "BUS-A" (which is assigned to Route-X)
```
**After:**
```
Student: Priya Singh (ADM002)
Route: "Route-B" (R2)
Bus ID: "BUS-B" (which is assigned to Route-B)
```

### Scenario 3: Route with No Buses
**Before:**
```
Employee: Sharma (EMP123)
Route: "Route-C" (R3)
Bus ID: null
```
**After (no change if R3 has no buses):**
```
Employee: Sharma (EMP123)
Route: "Route-C" (R3)
Bus ID: null
```
(Passenger remains unassigned until a bus is assigned to the route)

---

## Important Notes

1. **Academic Year:** Scripts default to `2026-2027`. Edit the scripts if you need a different year.

2. **Bus Assignment Priority:** When multiple buses are available on a route, the script picks the first one. Consider manual assignment if you need specific bus preferences.

3. **Stages & Routes:** These scripts only update `bus_id`. For fixing `stage_name` (from stage transfers), contact your admin about running the stage migration script.

4. **Approved Status Only:** Scripts only affect passengers with `status: 'approved'`. Pending requests are not touched.

---

## Troubleshooting

**Q: Script won't connect to database?**
A: Ensure `.env` file in backend folder has correct MongoDB connection string.

**Q: No updates were made?**
A: Check with diagnostic script first. Database might already be clean.

**Q: What if a route has no buses?**
A: Those passengers will have `bus_id: null`. Assign a bus to the route first, then re-run cleanup.

---

## Related Stage Transfer Fix

If passengers were transferred between stages/routes, their `stage_name` may not have been updated. See the fix applied to `transferStage()` function in `routeController.js` that now includes `stage_name` in update queries.
