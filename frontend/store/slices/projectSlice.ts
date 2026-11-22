import { StateCreator } from 'zustand';
import type { AppStore } from '../useStore';

export type ProjectItem = {
  id: string;
  status: string;
};

export type ProjectSliceState = {
  projects: Array<ProjectItem>;
  currentProjectId: string | null;
  isLoading: boolean;
};

export type ProjectSliceActions = {
  setProjects: (projects: Array<ProjectItem>) => void;
  setCurrentProject: (id: string) => void;
  setLoading: (isLoading: boolean) => void;
};

export type ProjectSlice = ProjectSliceState & ProjectSliceActions;

export const initialProjectState: ProjectSliceState = {
  projects: [],
  currentProjectId: null,
  isLoading: false,
};

export const createProjectSlice: StateCreator<AppStore, [], [], ProjectSlice> = (set) => ({
  ...initialProjectState,

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  setLoading: (isLoading) => set({ isLoading }),
});

/* =====================================================
   Narrow Selectors
===================================================== */
export const selectProjectState = (state: AppStore): ProjectSliceState => ({
  projects: state.projects,
  currentProjectId: state.currentProjectId,
  isLoading: state.isLoading,
});

export const selectProjects = (state: AppStore): Array<ProjectItem> =>
  state.projects;

export const selectCurrentProjectId = (state: AppStore): string | null =>
  state.currentProjectId;

export const selectIsProjectsLoading = (state: AppStore): boolean =>
  state.isLoading;

export const selectProjectActions = (state: AppStore): ProjectSliceActions => ({
  setProjects: state.setProjects,
  setCurrentProject: state.setCurrentProject,
  setLoading: state.setLoading,
});
