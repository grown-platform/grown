package tasks

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.TasksServiceServer over a Repository.
type Service struct {
	repo *Repository
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func callerCtx(ctx context.Context) (orgID, userID string, err error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, u.ID, nil
}

func listToProto(l List) *grownv1.TaskList {
	return &grownv1.TaskList{
		Id:          l.ID,
		OrgId:       l.OrgID,
		OwnerUserId: l.OwnerUserID,
		Name:        l.Name,
		Position:    l.Position,
		CreatedAt:   l.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func taskToProto(t TaskItem) *grownv1.Task {
	var dueAt, completedAt string
	if t.DueAt != nil {
		dueAt = t.DueAt.UTC().Format(time.RFC3339)
	}
	if t.CompletedAt != nil {
		completedAt = t.CompletedAt.UTC().Format(time.RFC3339)
	}
	return &grownv1.Task{
		Id:           t.ID,
		OrgId:        t.OrgID,
		ListId:       t.ListID,
		OwnerUserId:  t.OwnerUserID,
		Title:        t.Title,
		Notes:        t.Notes,
		DueAt:        dueAt,
		Completed:    t.Completed,
		CompletedAt:  completedAt,
		ParentTaskId: t.ParentTaskID,
		Position:     t.Position,
		CreatedAt:    t.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:    t.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// parseOptionalTime parses an RFC-3339 string (or empty) into *time.Time.
func parseOptionalTime(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid time %q: %v", s, err)
	}
	return &t, nil
}

// ----- Task list RPCs -----

func (s *Service) ListLists(ctx context.Context, _ *grownv1.ListTaskListsRequest) (*grownv1.ListTaskListsResponse, error) {
	orgID, userID, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	lists, err := s.repo.ListLists(ctx, orgID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list task lists: %v", err)
	}
	resp := &grownv1.ListTaskListsResponse{Lists: make([]*grownv1.TaskList, 0, len(lists))}
	for _, l := range lists {
		resp.Lists = append(resp.Lists, listToProto(l))
	}
	return resp, nil
}

func (s *Service) CreateList(ctx context.Context, req *grownv1.CreateTaskListRequest) (*grownv1.TaskList, error) {
	orgID, userID, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	l, err := s.repo.CreateList(ctx, orgID, userID, ListFields{Name: req.GetName()})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create task list: %v", err)
	}
	return listToProto(l), nil
}

func (s *Service) UpdateList(ctx context.Context, req *grownv1.UpdateTaskListRequest) (*grownv1.TaskList, error) {
	orgID, _, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	l, err := s.repo.UpdateList(ctx, orgID, req.GetId(), ListFields{Name: req.GetName()})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "task list not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update task list: %v", err)
	}
	return listToProto(l), nil
}

func (s *Service) DeleteList(ctx context.Context, req *grownv1.DeleteTaskListRequest) (*grownv1.DeleteTaskListResponse, error) {
	orgID, _, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.DeleteList(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "task list not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete task list: %v", err)
	}
	return &grownv1.DeleteTaskListResponse{}, nil
}

// ----- Task RPCs -----

func (s *Service) ListTasks(ctx context.Context, req *grownv1.ListTasksRequest) (*grownv1.ListTasksResponse, error) {
	orgID, _, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	tasks, err := s.repo.ListTasks(ctx, orgID, req.GetListId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list tasks: %v", err)
	}
	resp := &grownv1.ListTasksResponse{Tasks: make([]*grownv1.Task, 0, len(tasks))}
	for _, t := range tasks {
		resp.Tasks = append(resp.Tasks, taskToProto(t))
	}
	return resp, nil
}

func (s *Service) CreateTask(ctx context.Context, req *grownv1.CreateTaskRequest) (*grownv1.Task, error) {
	orgID, userID, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	dueAt, err := parseOptionalTime(req.GetDueAt())
	if err != nil {
		return nil, err
	}
	t, err := s.repo.CreateTask(ctx, orgID, req.GetListId(), userID, TaskFields{
		Title:        req.GetTitle(),
		Notes:        req.GetNotes(),
		DueAt:        dueAt,
		ParentTaskID: req.GetParentTaskId(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create task: %v", err)
	}
	return taskToProto(t), nil
}

func (s *Service) UpdateTask(ctx context.Context, req *grownv1.UpdateTaskRequest) (*grownv1.Task, error) {
	orgID, _, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	dueAt, err := parseOptionalTime(req.GetDueAt())
	if err != nil {
		return nil, err
	}
	t, err := s.repo.UpdateTask(ctx, orgID, req.GetId(), TaskFields{
		Title:        req.GetTitle(),
		Notes:        req.GetNotes(),
		DueAt:        dueAt,
		ParentTaskID: req.GetParentTaskId(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "task not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update task: %v", err)
	}
	return taskToProto(t), nil
}

func (s *Service) DeleteTask(ctx context.Context, req *grownv1.DeleteTaskRequest) (*grownv1.DeleteTaskResponse, error) {
	orgID, _, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.DeleteTask(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "task not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete task: %v", err)
	}
	return &grownv1.DeleteTaskResponse{}, nil
}

func (s *Service) ToggleTask(ctx context.Context, req *grownv1.ToggleTaskRequest) (*grownv1.Task, error) {
	orgID, _, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	t, err := s.repo.ToggleTask(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "task not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "toggle task: %v", err)
	}
	return taskToProto(t), nil
}

func (s *Service) ReorderTask(ctx context.Context, req *grownv1.ReorderTaskRequest) (*grownv1.Task, error) {
	orgID, _, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	t, err := s.repo.ReorderTask(ctx, orgID, req.GetId(), req.GetPosition())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "task not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "reorder task: %v", err)
	}
	return taskToProto(t), nil
}
