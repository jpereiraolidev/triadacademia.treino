/*
  Warnings:

  - A unique constraint covering the columns `[workoutId,order]` on the table `WorkoutExercise` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `nonce` to the `Invite` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "nonce" VARCHAR(8) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutExercise_workoutId_order_key" ON "WorkoutExercise"("workoutId", "order");
